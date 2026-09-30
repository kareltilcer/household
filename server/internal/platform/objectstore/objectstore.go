// Package objectstore is the platform's client of the S3-compatible object store (PRD 01 §8, PL-2):
// one private bucket, RustFS in development, whose keys the files pipeline and the account pictures
// name. Nothing reaches it directly: bytes go in through the API, which checks them first
// (internal/platform/files), and come out through URLs the API pre-signs, one object at a time,
// after it has authorised the caller (D-9).
//
// The store holds bytes write-once: PutOnce creates an object only where none is (If-None-Match),
// so a key once written keeps its bytes, however many requests race for it, and a request that
// finds its key taken can tell a retry of its own bytes, whose SHA-256 the object's metadata
// carries, from another's.
package objectstore

import (
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	v4 "github.com/aws/aws-sdk-go-v2/aws/signer/v4"
	awshttp "github.com/aws/aws-sdk-go-v2/aws/transport/http"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
)

var (
	// ErrExists is PutOnce's answer for a key that already holds an object.
	ErrExists = errors.New("objectstore: the key already holds an object")
	// ErrNotFound is the answer for a key that holds none.
	ErrNotFound = errors.New("objectstore: no object at the key")
)

// Location is where a store is and how to sign in to it, as its URL names it:
// http(s)://ACCESS_KEY:SECRET@host[:port]/bucket[?region=R], the bucket addressed by path, which
// every S3-compatible store serves.
type Location struct {
	// Endpoint is the store's scheme and host, with no path.
	Endpoint *url.URL
	Bucket   string
	Region   string
	// AccessKey and Secret sign every request.
	AccessKey, Secret string
}

// DefaultRegion is the region of a store whose URL names none: RustFS, like most stores that are
// not AWS's, accepts any.
const DefaultRegion = "us-east-1"

// bucketName is an S3 bucket name as every store accepts it.
var bucketName = regexp.MustCompile(`^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$`)

// ParseURL reads a store's URL. It refuses one that is not http or https, names no host, no
// bucket or a path beyond it, or carries no credentials, naming what is wrong but never the secret.
func ParseURL(raw string) (Location, error) {
	u, err := url.Parse(raw)
	if err != nil {
		return Location{}, errors.New("objectstore: the URL does not parse")
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return Location{}, errors.New("objectstore: the URL is not http or https")
	}
	if u.Host == "" {
		return Location{}, errors.New("objectstore: the URL names no host")
	}
	bucket := strings.Trim(u.Path, "/")
	if !bucketName.MatchString(bucket) {
		return Location{}, errors.New("objectstore: the URL's path is not one bucket's name")
	}
	secret, ok := u.User.Password()
	if u.User == nil || u.User.Username() == "" || !ok || secret == "" {
		return Location{}, errors.New("objectstore: the URL carries no access key and secret")
	}
	region := u.Query().Get("region")
	if region == "" {
		region = DefaultRegion
	}
	return Location{
		Endpoint:  &url.URL{Scheme: u.Scheme, Host: u.Host},
		Bucket:    bucket,
		Region:    region,
		AccessKey: u.User.Username(),
		Secret:    secret,
	}, nil
}

// Config is what a Store needs.
type Config struct {
	Location Location
	// Public is the scheme and host a client reaches the store at, which the URLs Presign issues
	// name; nil for the endpoint the server reaches it at.
	Public *url.URL
	// Attempts caps how many times a request is tried; the SDK's default when zero.
	Attempts int
	// HTTPClient sends the requests; the SDK's own when nil.
	HTTPClient *http.Client
}

// Store is one bucket of an S3-compatible store.
type Store struct {
	client *s3.Client
	bucket string
	region string
	creds  aws.Credentials
	public *url.URL
	signer *v4.Signer
}

// New returns the store cfg names. It makes no request: a store that cannot be reached fails the
// first one, as an upload's 502 (FR-NF3), rather than the process.
func New(cfg Config) (*Store, error) {
	loc := cfg.Location
	if loc.Endpoint == nil || loc.Bucket == "" || loc.AccessKey == "" || loc.Secret == "" {
		return nil, errors.New("objectstore: the store needs an endpoint, a bucket and credentials")
	}
	region := loc.Region
	if region == "" {
		region = DefaultRegion
	}
	public := cfg.Public
	if public == nil {
		public = loc.Endpoint
	}
	creds := aws.Credentials{AccessKeyID: loc.AccessKey, SecretAccessKey: loc.Secret, Source: "household"}
	opts := s3.Options{
		Region:       region,
		BaseEndpoint: aws.String(loc.Endpoint.String()),
		UsePathStyle: true,
		Credentials:  credentials.StaticCredentialsProvider{Value: creds},
		// A checksum only where the operation requires one: stores that are not AWS's differ in
		// which of the SDK's trailing checksums they accept. The SHA-256 the files pipeline computes
		// travels as the object's metadata instead.
		RequestChecksumCalculation: aws.RequestChecksumCalculationWhenRequired,
		ResponseChecksumValidation: aws.ResponseChecksumValidationWhenRequired,
		RetryMaxAttempts:           cfg.Attempts,
	}
	if cfg.HTTPClient != nil {
		opts.HTTPClient = cfg.HTTPClient
	}
	return &Store{
		client: s3.New(opts),
		bucket: loc.Bucket,
		region: region,
		creds:  creds,
		public: &url.URL{Scheme: public.Scheme, Host: public.Host},
		signer: v4.NewSigner(),
	}, nil
}

// Bucket is the bucket the store reads and writes.
func (s *Store) Bucket() string { return s.bucket }

// key is the form of every key the platform writes: lowercase words, digits, dashes and
// underscores, in segments joined by slashes. Checking it here keeps a key from escaping its
// prefix, and from needing escapes in a signed URL.
var key = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]*(?:/[a-z0-9][a-z0-9_-]*)*$`)

// ValidKey reports whether k is a key the store writes.
func ValidKey(k string) bool { return key.MatchString(k) }

// Object is what PutOnce stores beside the bytes.
type Object struct {
	// ContentType is the type the bytes were sniffed as, which the store answers with.
	ContentType string
	// SHA256 is the bytes' digest, kept as the object's metadata.
	SHA256 [32]byte
}

// cacheControl is every object's: its bytes never change, so a client may keep them for as long as
// it likes, but no shared cache may.
const cacheControl = "private, max-age=31536000, immutable"

// sha256Meta is the metadata key the digest is kept under (x-amz-meta-sha256).
const sha256Meta = "sha256"

// PutOnce writes size bytes from body to k, which must hold no object yet: ErrExists when it does,
// whoever wrote it. body is read again from its start should a request be retried.
func (s *Store) PutOnce(ctx context.Context, k string, body io.ReadSeeker, size int64, o Object) error {
	if !ValidKey(k) {
		return fmt.Errorf("objectstore: %q is not a key", k)
	}
	_, err := s.client.PutObject(ctx, &s3.PutObjectInput{
		Bucket:        aws.String(s.bucket),
		Key:           aws.String(k),
		Body:          body,
		ContentLength: aws.Int64(size),
		ContentType:   aws.String(o.ContentType),
		CacheControl:  aws.String(cacheControl),
		Metadata:      map[string]string{sha256Meta: hex.EncodeToString(o.SHA256[:])},
		IfNoneMatch:   aws.String("*"),
	})
	switch {
	case status(err) == http.StatusPreconditionFailed:
		return ErrExists
	case err != nil:
		return fmt.Errorf("objectstore: put %s: %w", k, err)
	}
	return nil
}

// PutSame is PutOnce for a caller whose own bytes may be at k already: a write the store kept but
// whose answer was lost, sent again by the store's client or by a retry of the request that wrote
// it. Bytes there with o's digest are that write, and PutSame succeeds; bytes with another digest,
// or with none, are another's, and it answers ErrExists.
func (s *Store) PutSame(ctx context.Context, k string, body io.ReadSeeker, size int64, o Object) error {
	err := s.PutOnce(ctx, k, body, size, o)
	if !errors.Is(err, ErrExists) {
		return err
	}
	info, err := s.Head(ctx, k)
	switch {
	case err != nil:
		return err
	case !info.HasSHA256 || info.SHA256 != o.SHA256:
		return ErrExists
	}
	return nil
}

// Info is what the store holds about an object.
type Info struct {
	Key          string
	Size         int64
	ContentType  string
	LastModified time.Time
	// SHA256 is the digest PutOnce kept, and false when the object carries none, as one written
	// otherwise would not.
	SHA256    [32]byte
	HasSHA256 bool
}

// Head returns what the store holds about the object at k, or ErrNotFound.
func (s *Store) Head(ctx context.Context, k string) (Info, error) {
	out, err := s.client.HeadObject(ctx, &s3.HeadObjectInput{Bucket: aws.String(s.bucket), Key: aws.String(k)})
	if err != nil {
		if missing(err) {
			return Info{}, ErrNotFound
		}
		return Info{}, fmt.Errorf("objectstore: head %s: %w", k, err)
	}
	info := Info{
		Key: k, Size: aws.ToInt64(out.ContentLength), ContentType: aws.ToString(out.ContentType),
		LastModified: aws.ToTime(out.LastModified),
	}
	info.SHA256, info.HasSHA256 = digest(out.Metadata[sha256Meta])
	return info, nil
}

// Get opens the object at k, or answers ErrNotFound. The caller closes it.
func (s *Store) Get(ctx context.Context, k string) (io.ReadCloser, Info, error) {
	out, err := s.client.GetObject(ctx, &s3.GetObjectInput{Bucket: aws.String(s.bucket), Key: aws.String(k)})
	if err != nil {
		if missing(err) {
			return nil, Info{}, ErrNotFound
		}
		return nil, Info{}, fmt.Errorf("objectstore: get %s: %w", k, err)
	}
	info := Info{
		Key: k, Size: aws.ToInt64(out.ContentLength), ContentType: aws.ToString(out.ContentType),
		LastModified: aws.ToTime(out.LastModified),
	}
	info.SHA256, info.HasSHA256 = digest(out.Metadata[sha256Meta])
	return out.Body, info, nil
}

// Delete removes the objects at keys. A key that holds none is not an error, so a purge that runs
// twice, or beside the sweep, succeeds both times. Each is removed on its own: DeleteObjects needs
// a checksum the stores disagree about, and a purge names a handful.
func (s *Store) Delete(ctx context.Context, keys ...string) error {
	for _, k := range keys {
		_, err := s.client.DeleteObject(ctx, &s3.DeleteObjectInput{Bucket: aws.String(s.bucket), Key: aws.String(k)})
		if err != nil && !missing(err) {
			return fmt.Errorf("objectstore: delete %s: %w", k, err)
		}
	}
	return nil
}

// List calls fn with each object whose key starts with prefix, in key order, until fn returns an
// error, which List returns. Its Info carries no content type or digest, which a listing does not.
func (s *Store) List(ctx context.Context, prefix string, fn func(Info) error) error {
	pages := s3.NewListObjectsV2Paginator(s.client, &s3.ListObjectsV2Input{
		Bucket: aws.String(s.bucket), Prefix: aws.String(prefix),
	})
	for pages.HasMorePages() {
		page, err := pages.NextPage(ctx)
		if err != nil {
			return fmt.Errorf("objectstore: list %s: %w", prefix, err)
		}
		for _, o := range page.Contents {
			if err := fn(Info{Key: aws.ToString(o.Key), Size: aws.ToInt64(o.Size), LastModified: aws.ToTime(o.LastModified)}); err != nil {
				return err
			}
		}
	}
	return nil
}

// Check asks the store whether the bucket is there, for a log line at start.
func (s *Store) Check(ctx context.Context) error {
	if _, err := s.client.HeadBucket(ctx, &s3.HeadBucketInput{Bucket: aws.String(s.bucket)}); err != nil {
		return fmt.Errorf("objectstore: bucket %s: %w", s.bucket, err)
	}
	return nil
}

// CreateBucket makes the bucket, unless it is there already. Development makes its own; a deployed
// store's bucket is provisioned with its versioning and its replication, never by the server
// (docs/runbooks/object-storage.md).
func (s *Store) CreateBucket(ctx context.Context) error {
	if err := s.Check(ctx); err == nil {
		return nil
	}
	_, err := s.client.CreateBucket(ctx, &s3.CreateBucketInput{Bucket: aws.String(s.bucket)})
	var owned *types.BucketAlreadyOwnedByYou
	if err != nil && !errors.As(err, &owned) {
		return fmt.Errorf("objectstore: create bucket %s: %w", s.bucket, err)
	}
	return nil
}

// RemoveBucket removes every object in the bucket and then the bucket: a test's, at its end.
func (s *Store) RemoveBucket(ctx context.Context) error {
	var keys []string
	if err := s.List(ctx, "", func(i Info) error {
		keys = append(keys, i.Key)
		return nil
	}); err != nil {
		return err
	}
	if err := s.Delete(ctx, keys...); err != nil {
		return err
	}
	if _, err := s.client.DeleteBucket(ctx, &s3.DeleteBucketInput{Bucket: aws.String(s.bucket)}); err != nil {
		return fmt.Errorf("objectstore: remove bucket %s: %w", s.bucket, err)
	}
	return nil
}

// Bucket is a bucket the store's credentials own.
type Bucket struct {
	Name    string
	Created time.Time
}

// Buckets lists the buckets the store's credentials own: the tests sweep those a killed run left.
func (s *Store) Buckets(ctx context.Context) ([]Bucket, error) {
	out, err := s.client.ListBuckets(ctx, &s3.ListBucketsInput{})
	if err != nil {
		return nil, fmt.Errorf("objectstore: list buckets: %w", err)
	}
	buckets := make([]Bucket, 0, len(out.Buckets))
	for _, b := range out.Buckets {
		buckets = append(buckets, Bucket{Name: aws.ToString(b.Name), Created: aws.ToTime(b.CreationDate)})
	}
	return buckets, nil
}

// Disposition is how a client is to treat what a link fetches.
type Disposition string

// The two dispositions of the contract's ContentLink.
const (
	// Inline may be shown in place: an image, a PDF, plain text.
	Inline Disposition = "inline"
	// Attachment is saved, never rendered: an active type, HTML or SVG, and anything a browser does
	// not show (FR-FL2).
	Attachment Disposition = "attachment"
)

// Presentation is what a pre-signed URL makes the store answer with, whatever the object says.
type Presentation struct {
	ContentType string
	Disposition Disposition
	// Filename is the name a download is saved under, "" for none.
	Filename string
}

// The pre-signed URLs' window: each is signed as of the start of the five minutes it is issued in,
// and lasts fifteen from then, so that it is valid for ten minutes at least and fifteen at most, and
// every link to one object issued in the same five minutes is the same URL, which a client's cache
// keeps.
const (
	LinkWindow   = 5 * time.Minute
	LinkLifetime = 15 * time.Minute
)

// Presign returns a URL that fetches the object at k, as p presents it, and the time it stops
// working. It makes no request, and is issued for one object only, never a prefix (D-9): the
// caller has authorised the one who receives it first.
func (s *Store) Presign(ctx context.Context, k string, p Presentation, now time.Time) (string, time.Time, error) {
	if !ValidKey(k) {
		return "", time.Time{}, fmt.Errorf("objectstore: %q is not a key", k)
	}
	signed := now.UTC().Truncate(LinkWindow)
	u := *s.public
	u.Path = "/" + s.bucket + "/" + k
	q := url.Values{}
	q.Set("X-Amz-Expires", strconv.Itoa(int(LinkLifetime/time.Second)))
	if p.ContentType != "" {
		q.Set("response-content-type", p.ContentType)
	}
	disposition := string(p.Disposition)
	if disposition == "" {
		disposition = string(Attachment)
	}
	if p.Filename != "" {
		if d := mime.FormatMediaType(disposition, map[string]string{"filename": p.Filename}); d != "" {
			disposition = d
		}
	}
	q.Set("response-content-disposition", disposition)
	u.RawQuery = q.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return "", time.Time{}, err
	}
	uri, _, err := s.signer.PresignHTTP(ctx, s.creds, req, "UNSIGNED-PAYLOAD", "s3", s.region, signed)
	if err != nil {
		return "", time.Time{}, fmt.Errorf("objectstore: presign %s: %w", k, err)
	}
	return uri, signed.Add(LinkLifetime), nil
}

// status is the HTTP status a failed request was answered with, 0 for one that was not.
func status(err error) int {
	var re *awshttp.ResponseError
	if errors.As(err, &re) {
		return re.HTTPStatusCode()
	}
	return 0
}

// missing reports whether err says there is no such object: a typed NoSuchKey or NotFound, or a
// bare 404, which a HEAD answers with, having no body to type.
func missing(err error) bool {
	var nsk *types.NoSuchKey
	var nf *types.NotFound
	return errors.As(err, &nsk) || errors.As(err, &nf) || status(err) == http.StatusNotFound
}

// digest reads the hex digest the metadata carries.
func digest(s string) ([32]byte, bool) {
	var d [32]byte
	b, err := hex.DecodeString(s)
	if err != nil || len(b) != len(d) {
		return d, false
	}
	copy(d[:], b)
	return d, true
}

package files

import (
	"archive/zip"
	"bytes"
	"encoding/binary"
	"errors"
	"io"
	"net/http"
	"path"
	"slices"
	"strings"
	"unicode"
	"unicode/utf16"
	"unicode/utf8"

	"github.com/kareltilcer/household/server/internal/platform/objectstore"
)

// Class is what the platform does with a type (FR-FL1–3): whether it takes it, how a link presents
// it, and which variants it derives from it.
type Class string

// The classes.
const (
	// ClassRaster is an image this server decodes: it gets a thumbnail and a preview.
	ClassRaster Class = "raster"
	// ClassPicture is another image, HEIC, AVIF or an icon: kept and shown where the client can, with
	// no variants.
	ClassPicture Class = "picture"
	// ClassPDF gets its first page as a preview and a thumbnail.
	ClassPDF Class = "pdf"
	// ClassOffice is a document office software opens: it gets a PDF, and the PDF's first page.
	ClassOffice Class = "office"
	// ClassText is plain text, shown as text.
	ClassText Class = "text"
	// ClassMedia is audio or video.
	ClassMedia Class = "media"
	// ClassArchive is a compressed archive, saved and never opened by the platform.
	ClassArchive Class = "archive"
	// ClassActive is a type a browser runs, HTML, SVG or XML: download-only, never rendered in the app's
	// origin (FR-FL2).
	ClassActive Class = "active"
	// ClassBinary is anything not recognised: kept, download-only.
	ClassBinary Class = "binary"
	// ClassBlocked is a program, which no route takes: 415.
	ClassBlocked Class = "blocked"
)

// Type is what an upload's bytes were sniffed as: the client's header is never trusted (FR-FL1).
type Type struct {
	// MIME is the media type the object is stored and served as.
	MIME  string
	Class Class
	// Ext is the type's usual extension, which the converter is told the type by, "" for none.
	Ext string
}

// Disposition is how a link presents the type: in place for what a browser shows safely, as a
// download for everything else, the active types always (FR-FL2).
func (t Type) Disposition() objectstore.Disposition {
	switch t.Class {
	case ClassRaster, ClassPicture, ClassPDF, ClassText, ClassMedia:
		return objectstore.Inline
	case ClassOffice, ClassArchive, ClassActive, ClassBinary, ClassBlocked:
		return objectstore.Attachment
	}
	return objectstore.Attachment
}

// Derives reports whether the platform derives variants from the type (FR-FL3).
func (t Type) Derives() bool {
	return t.Class == ClassRaster || t.Class == ClassPDF || t.Class == ClassOffice
}

// Accept says whether a route takes a type. A blocked type is refused before it is asked.
type Accept func(Type) bool

// AnyType takes every type that is not blocked: a document, an attachment.
func AnyType(Type) bool { return true }

// Images takes the images: a note's inline image, a photograph of a plant.
func Images(t Type) bool { return t.Class == ClassRaster || t.Class == ClassPicture }

// sniffLen is how much of the start of a file the sniffer reads; the containers, ZIP and the
// compound file, it reads further into.
const sniffLen = 4096

// Sniff returns the type of the size bytes r reads, from the bytes themselves (FR-FL1). name, the
// client's, never makes a type: it only refines plain text into the kind of text it is, and a
// program's extension blocks a file whatever its bytes are, since a script is text to a sniffer.
func Sniff(r io.ReaderAt, size int64, name string) Type {
	head := make([]byte, min(size, sniffLen))
	n, _ := r.ReadAt(head, 0)
	head = head[:n]
	// Windows drops the dots and spaces that end a name as it saves the file, and a browser does
	// before it: "run.bat." is saved as run.bat, so it is read as that.
	name = strings.TrimRightFunc(name, func(r rune) bool { return r == '.' || unicode.IsSpace(r) })
	ext := strings.ToLower(strings.TrimPrefix(path.Ext(name), "."))
	if slices.Contains(programExtensions, ext) {
		return Type{MIME: "application/octet-stream", Class: ClassBlocked}
	}
	if t, ok := magic(head); ok {
		return t
	}
	switch {
	case bytes.HasPrefix(head, []byte("PK\x03\x04")), bytes.HasPrefix(head, []byte("PK\x05\x06")):
		return sniffZip(r, size)
	case bytes.HasPrefix(head, cfbMagic):
		return sniffCFB(r)
	case bytes.Contains(head[:min(len(head), 1024)], []byte("%PDF-")):
		return Type{MIME: "application/pdf", Class: ClassPDF, Ext: "pdf"}
	case bytes.HasPrefix(head, []byte("{\\rtf")):
		return Type{MIME: "application/rtf", Class: ClassOffice, Ext: "rtf"}
	}
	if t, ok := sniffBMFF(head); ok {
		return t
	}
	if t, ok := sniffMarkup(head); ok {
		return t
	}
	detected, _, _ := strings.Cut(http.DetectContentType(head), ";")
	if t, ok := detectedTypes[detected]; ok {
		return t
	}
	// Text is text whatever net/http's sniffer takes its first bytes for: "BMW service" is no bitmap.
	if detected == "text/plain" || decodeText(head) != "" {
		return sniffText(head, ext, size > int64(len(head)))
	}
	return Type{MIME: "application/octet-stream", Class: ClassBinary}
}

// programExtensions block a file by its name: a program, an installer or a script, which a
// sniffer cannot always tell from text or from an archive, and what the system opening it runs as
// one: a management console (msc, XML to a sniffer), a program's shortcut (pif), a Windows script
// component or scriptlet (ws, wsc, sct), a transform an installer applies (mst), a browser-hosted
// application (xbap) or one Java Web Start fetches (jnlp), a shortcut to a place that runs what it
// names (url, library-ms, settingcontent-ms), a desktop gadget, a macOS script Terminal runs when it
// is opened (command), help Windows opens in a browser that runs its scripts (chm, hlp), a
// troubleshooting pack (diagcab, diagcfg, diagpack), an Access project with its code (ade, adp, mde),
// an Internet settings file (ins, isp), a shell scrap (shb, shs), PowerShell's and its predecessor's
// formats and consoles (ps1xml, ps2, ps2xml, psc1, psc2, psd1, msh, msh1, msh2, mshxml, msh1xml,
// msh2xml), a Visual Basic source or a driver (vb, bas, sys, vxd), an Excel add-in (xll), an
// installer's bundle or its manifest (appxbundle, msixbundle, appinstaller), a disk image Windows
// mounts when it is opened, whose programs then run without the mark that says they were downloaded
// (iso, img, vhd, vhdx), a Windows update package, which installs itself when it is opened (msu), a
// ClickOnce application's reference, which fetches and starts it (appref-ms), a Python program, its
// source, its bytecode or its zipped application, which the Python launcher runs when it is opened
// (py, pyw, pyc, pyo, pyz, pyzw), a Perl program (pl), a script of the shells beside sh (bash, zsh,
// ksh, csh), a macOS command Terminal runs, or its settings, which name one to run (tool,
// terminal), a launcher a Linux desktop runs what it names from (desktop), an Access database's
// compiled form or its add-in, as mde is (accde, mda), a sandbox's configuration, which names the
// command it runs at sign-in (wsb), an installer's setup information (inf), and a pinned site or a
// search, which open what they name (website, search-ms, searchconnector-ms).
var programExtensions = []string{
	"exe", "com", "scr", "msi", "msp", "dll", "bat", "cmd", "ps1", "psm1", "vbs", "vbe", "js", "jse", "wsf", "wsh",
	"hta", "cpl", "lnk", "jar", "apk", "aab", "ipa", "appx", "msix", "app", "dmg", "pkg", "deb", "rpm", "sh", "run",
	"reg", "scf", "application", "msc", "pif", "ws", "wsc", "sct", "mst", "xbap", "url", "library-ms",
	"settingcontent-ms", "gadget", "command", "jnlp", "chm", "hlp", "diagcab", "diagcfg", "diagpack", "ade", "adp",
	"mde", "ins", "isp", "shb", "shs", "ps1xml", "ps2", "ps2xml", "psc1", "psc2", "psd1", "msh", "msh1", "msh2",
	"mshxml", "msh1xml", "msh2xml", "vb", "bas", "sys", "vxd", "xll", "appxbundle", "msixbundle", "appinstaller", "iso",
	"img", "vhd", "vhdx", "msu", "appref-ms", "py", "pyw", "pyc", "pyo", "pyz", "pyzw", "pl", "bash", "zsh", "ksh",
	"csh", "tool", "terminal", "desktop", "accde", "mda", "wsb", "inf", "website", "search-ms", "searchconnector-ms",
}

// signatures are the types known by their first bytes, the programs among them.
var signatures = []struct {
	prefix string
	typ    Type
}{
	{"\x7fELF", Type{MIME: "application/x-elf", Class: ClassBlocked}},
	{"\xfe\xed\xfa\xce", Type{MIME: "application/x-mach-binary", Class: ClassBlocked}},
	{"\xfe\xed\xfa\xcf", Type{MIME: "application/x-mach-binary", Class: ClassBlocked}},
	{"\xce\xfa\xed\xfe", Type{MIME: "application/x-mach-binary", Class: ClassBlocked}},
	{"\xcf\xfa\xed\xfe", Type{MIME: "application/x-mach-binary", Class: ClassBlocked}},
	// A universal Mach-O binary, or a Java class, which share the magic.
	{"\xca\xfe\xba\xbe", Type{MIME: "application/x-mach-binary", Class: ClassBlocked}},
	{"#!", Type{MIME: "text/x-shellscript", Class: ClassBlocked}},
	{"dex\n", Type{MIME: "application/vnd.android.dex", Class: ClassBlocked}},
	{"L\x00\x00\x00\x01\x14\x02\x00", Type{MIME: "application/x-ms-shortcut", Class: ClassBlocked}},
	{"\xff\xd8\xff", Type{MIME: "image/jpeg", Class: ClassRaster, Ext: "jpg"}},
	{"\x89PNG\r\n\x1a\n", Type{MIME: "image/png", Class: ClassRaster, Ext: "png"}},
	{"GIF87a", Type{MIME: "image/gif", Class: ClassRaster, Ext: "gif"}},
	{"GIF89a", Type{MIME: "image/gif", Class: ClassRaster, Ext: "gif"}},
	{"II*\x00", Type{MIME: "image/tiff", Class: ClassRaster, Ext: "tif"}},
	{"MM\x00*", Type{MIME: "image/tiff", Class: ClassRaster, Ext: "tif"}},
	{"\x00\x00\x01\x00", Type{MIME: "image/x-icon", Class: ClassPicture, Ext: "ico"}},
	{"fLaC", Type{MIME: "audio/flac", Class: ClassMedia, Ext: "flac"}},
	{"OggS", Type{MIME: "audio/ogg", Class: ClassMedia, Ext: "ogg"}},
	{"7z\xbc\xaf\x27\x1c", Type{MIME: "application/x-7z-compressed", Class: ClassArchive, Ext: "7z"}},
	{"Rar!\x1a\x07", Type{MIME: "application/vnd.rar", Class: ClassArchive, Ext: "rar"}},
	{"\xfd7zXZ\x00", Type{MIME: "application/x-xz", Class: ClassArchive, Ext: "xz"}},
	{"\x1f\x8b", Type{MIME: "application/gzip", Class: ClassArchive, Ext: "gz"}},
}

// magic returns the type head's first bytes name, and false for none.
func magic(head []byte) (Type, bool) {
	for _, s := range signatures {
		if bytes.HasPrefix(head, []byte(s.prefix)) {
			return s.typ, true
		}
	}
	switch {
	case bytes.HasPrefix(head, []byte("MZ")) && decodeText(head) == "":
		// A Windows or DOS program. Text that happens to start "MZ" is left to be text.
		return Type{MIME: "application/vnd.microsoft.portable-executable", Class: ClassBlocked}, true
	case len(head) >= 4 && string(head[:3]) == "BZh" && head[3] >= '1' && head[3] <= '9':
		return Type{MIME: "application/x-bzip2", Class: ClassArchive, Ext: "bz2"}, true
	case len(head) >= 12 && string(head[:4]) == "RIFF" && string(head[8:12]) == "WEBP":
		return Type{MIME: "image/webp", Class: ClassRaster, Ext: "webp"}, true
	case len(head) >= 14 && string(head[:2]) == "BM" && binary.LittleEndian.Uint32(head[6:]) == 0:
		// A bitmap's reserved word is zero, which text starting "BM" seldom has.
		return Type{MIME: "image/bmp", Class: ClassRaster, Ext: "bmp"}, true
	case len(head) > 262 && string(head[257:262]) == "ustar":
		return Type{MIME: "application/x-tar", Class: ClassArchive, Ext: "tar"}, true
	}
	return Type{}, false
}

// detectedTypes are the types net/http's sniffer names that magic does not, as the platform keeps
// them.
var detectedTypes = map[string]Type{
	"audio/mpeg":                   {MIME: "audio/mpeg", Class: ClassMedia, Ext: "mp3"},
	"audio/wave":                   {MIME: "audio/wav", Class: ClassMedia, Ext: "wav"},
	"audio/aiff":                   {MIME: "audio/aiff", Class: ClassMedia, Ext: "aiff"},
	"audio/midi":                   {MIME: "audio/midi", Class: ClassMedia, Ext: "mid"},
	"application/ogg":              {MIME: "audio/ogg", Class: ClassMedia, Ext: "ogg"},
	"video/webm":                   {MIME: "video/webm", Class: ClassMedia, Ext: "webm"},
	"video/avi":                    {MIME: "video/x-msvideo", Class: ClassMedia, Ext: "avi"},
	"text/html":                    {MIME: "text/html", Class: ClassActive, Ext: "html"},
	"text/xml":                     {MIME: "application/xml", Class: ClassActive, Ext: "xml"},
	"application/x-rar-compressed": {MIME: "application/vnd.rar", Class: ClassArchive, Ext: "rar"},
}

// sniffBMFF reads an ISO base media file's ftyp box: HEIC and AVIF photographs, MP4 and QuickTime
// video, M4A audio, told apart by their brands.
func sniffBMFF(head []byte) (Type, bool) {
	if len(head) < 16 || string(head[4:8]) != "ftyp" {
		return Type{}, false
	}
	end := min(int(binary.BigEndian.Uint32(head)), len(head))
	if end < 16 {
		return Type{}, false
	}
	brands := []string{string(head[8:12])}
	for i := 16; i+4 <= end; i += 4 {
		brands = append(brands, string(head[i:i+4]))
	}
	has := func(names ...string) bool {
		return slices.ContainsFunc(brands, func(b string) bool { return slices.Contains(names, b) })
	}
	switch {
	case has("avif", "avis"):
		return Type{MIME: "image/avif", Class: ClassPicture, Ext: "avif"}, true
	case has("heic", "heix", "hevc", "hevx", "heim", "heis"):
		return Type{MIME: "image/heic", Class: ClassPicture, Ext: "heic"}, true
	case has("mif1", "msf1"):
		return Type{MIME: "image/heif", Class: ClassPicture, Ext: "heif"}, true
	}
	switch brands[0] {
	case "qt  ":
		return Type{MIME: "video/quicktime", Class: ClassMedia, Ext: "mov"}, true
	case "M4A ", "M4B ":
		return Type{MIME: "audio/mp4", Class: ClassMedia, Ext: "m4a"}, true
	case "3gp4", "3gp5", "3gp6", "3g2a":
		return Type{MIME: "video/3gpp", Class: ClassMedia, Ext: "3gp"}, true
	}
	if has("isom", "iso2", "iso4", "iso5", "iso6", "mp41", "mp42", "avc1", "dash", "M4V ", "MSNV") {
		return Type{MIME: "video/mp4", Class: ClassMedia, Ext: "mp4"}, true
	}
	return Type{MIME: "application/octet-stream", Class: ClassBinary}, true
}

// sniffMarkup finds what a browser would run in text: an SVG, which net/http's sniffer takes for
// XML or plain text, or an HTML page it does not know by its first tag.
func sniffMarkup(head []byte) (Type, bool) {
	text := decodeText(head)
	if text == "" {
		return Type{}, false
	}
	lower := strings.ToLower(text)
	switch {
	case strings.Contains(lower, "<svg"):
		return Type{MIME: "image/svg+xml", Class: ClassActive, Ext: "svg"}, true
	case strings.Contains(lower, "<html"), strings.Contains(lower, "<!doctype html"), strings.Contains(lower, "<script"),
		strings.Contains(lower, "<iframe"), strings.Contains(lower, "<body"):
		return Type{MIME: "text/html", Class: ClassActive, Ext: "html"}, true
	case strings.HasPrefix(strings.TrimSpace(lower), "<?xml"):
		return Type{MIME: "application/xml", Class: ClassActive, Ext: "xml"}, true
	}
	return Type{}, false
}

// decodeText returns head as text when it is UTF-8 or UTF-16 with its byte-order mark, "" when it
// is neither. A multi-byte character cut at the end of head does not make it binary.
func decodeText(head []byte) string {
	switch {
	case bytes.HasPrefix(head, []byte{0xFE, 0xFF}), bytes.HasPrefix(head, []byte{0xFF, 0xFE}):
		order := binary.ByteOrder(binary.BigEndian)
		if head[0] == 0xFF {
			order = binary.LittleEndian
		}
		units := make([]uint16, 0, len(head)/2)
		for i := 2; i+1 < len(head); i += 2 {
			units = append(units, order.Uint16(head[i:]))
		}
		return string(utf16.Decode(units))
	}
	text := head
	for i := 0; i < 3 && len(text) > 0 && !utf8.Valid(text); i++ {
		text = text[:len(text)-1]
	}
	if !utf8.Valid(text) || bytes.IndexByte(text, 0) >= 0 {
		return ""
	}
	return string(bytes.TrimPrefix(text, []byte{0xEF, 0xBB, 0xBF}))
}

// textTypes are the kinds of plain text a name's extension may say it is. It never makes text of
// bytes that are not, nor anything but text.
var textTypes = map[string]Type{
	"csv":      {MIME: "text/csv", Class: ClassText, Ext: "csv"},
	"md":       {MIME: "text/markdown", Class: ClassText, Ext: "md"},
	"markdown": {MIME: "text/markdown", Class: ClassText, Ext: "md"},
	"json":     {MIME: "application/json", Class: ClassText, Ext: "json"},
	"ics":      {MIME: "text/calendar", Class: ClassText, Ext: "ics"},
	"vcf":      {MIME: "text/vcard", Class: ClassText, Ext: "vcf"},
	"gpx":      {MIME: "application/gpx+xml", Class: ClassActive, Ext: "gpx"},
}

// sniffText returns the kind of plain text head is, by the extension of the client's name, in
// UTF-8 when head is: truncated says the file goes on past head, whose end may then cut a character
// in two.
func sniffText(head []byte, ext string, truncated bool) Type {
	t, ok := textTypes[ext]
	if !ok {
		t = Type{MIME: "text/plain", Class: ClassText, Ext: "txt"}
	}
	if t.Class == ClassText && t.MIME != "application/json" && utf8Text(head, truncated) {
		t.MIME += "; charset=utf-8"
	}
	return t
}

// utf8Text reports whether head is UTF-8. Only a file that goes on past head, truncated, may end it
// in the first bytes of a character, which the rest of the file completes; a file that ends there,
// or bytes that begin no character, are some other encoding, Latin-1's "Caf\xe9" among them, which
// a browser told it was UTF-8 would show with a replacement character for its last letter.
func utf8Text(head []byte, truncated bool) bool {
	if utf8.Valid(head) {
		return true
	}
	for cut := 1; truncated && cut < utf8.UTFMax && cut <= len(head); cut++ {
		if rest := head[len(head)-cut:]; utf8.Valid(head[:len(head)-cut]) && utf8.RuneStart(rest[0]) && !utf8.FullRune(rest) {
			return true
		}
	}
	return false
}

// maxZipDirectory bounds what sniffZip reads of a ZIP, its end record and its central directory
// among it: zip.NewReader holds every entry the directory lists, however many that is, and a 100 MB
// ZIP of empty entries lists two million of them, half a gigabyte for one upload. A document's
// directory is a few kilobytes and a large application's a megabyte or two; one larger is read no
// further, and the file is an archive.
const maxZipDirectory = 4 << 20

// errZipDirectory is boundedReader's answer once a ZIP's reading is past maxZipDirectory.
var errZipDirectory = errors.New("files: the ZIP's directory is larger than the sniffer reads")

// boundedReader reads from r until it has read left bytes in all, and refuses every read after.
type boundedReader struct {
	r    io.ReaderAt
	left int64
}

func (b *boundedReader) ReadAt(p []byte, off int64) (int, error) {
	if int64(len(p)) > b.left {
		b.left = 0
		return 0, errZipDirectory
	}
	b.left -= int64(len(p))
	return b.r.ReadAt(p, off)
}

// sniffZip reads a ZIP's directory: an office document, a program in an archive's clothing (a JAR,
// an Android or Windows package), or an archive.
func sniffZip(r io.ReaderAt, size int64) Type {
	archive := Type{MIME: "application/zip", Class: ClassArchive, Ext: "zip"}
	z, err := zip.NewReader(&boundedReader{r: r, left: maxZipDirectory}, size)
	if err != nil {
		return archive
	}
	names := map[string]bool{}
	var prefixes []string
	for i, f := range z.File {
		if i >= 10000 {
			break
		}
		names[f.Name] = true
		if top, _, found := strings.Cut(f.Name, "/"); found {
			prefixes = append(prefixes, top)
		}
	}
	switch {
	case names["META-INF/MANIFEST.MF"], names["AndroidManifest.xml"], names["classes.dex"], names["AppxManifest.xml"],
		slices.Contains(prefixes, "Payload"):
		return Type{MIME: "application/java-archive", Class: ClassBlocked}
	case names["mimetype"]:
		if t, ok := odfTypes[zipText(z, "mimetype")]; ok {
			return t
		}
		return archive
	case names["[Content_Types].xml"]:
		macro := names["word/vbaProject.bin"] || names["xl/vbaProject.bin"] || names["ppt/vbaProject.bin"]
		for _, o := range ooxml {
			if slices.Contains(prefixes, o.dir) {
				t := o.typ
				if macro {
					t.MIME, t.Ext = o.macro, o.macroExt
				}
				return t
			}
		}
	}
	return archive
}

// odfTypes are the OpenDocument types, by the mimetype entry every such file starts with.
var odfTypes = map[string]Type{
	"application/vnd.oasis.opendocument.text":         {MIME: "application/vnd.oasis.opendocument.text", Class: ClassOffice, Ext: "odt"},
	"application/vnd.oasis.opendocument.spreadsheet":  {MIME: "application/vnd.oasis.opendocument.spreadsheet", Class: ClassOffice, Ext: "ods"},
	"application/vnd.oasis.opendocument.presentation": {MIME: "application/vnd.oasis.opendocument.presentation", Class: ClassOffice, Ext: "odp"},
	"application/vnd.oasis.opendocument.graphics":     {MIME: "application/vnd.oasis.opendocument.graphics", Class: ClassOffice, Ext: "odg"},
	"application/epub+zip":                            {MIME: "application/epub+zip", Class: ClassBinary, Ext: "epub"},
}

// ooxml are the Office Open XML types, by the directory their parts are in, each with the type and
// the extension of its macro-enabled kind, which the converter is told as it is told any other.
var ooxml = []struct {
	dir             string
	typ             Type
	macro, macroExt string
}{
	{"word", Type{MIME: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", Class: ClassOffice, Ext: "docx"},
		"application/vnd.ms-word.document.macroEnabled.12", "docm"},
	{"xl", Type{MIME: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", Class: ClassOffice, Ext: "xlsx"},
		"application/vnd.ms-excel.sheet.macroEnabled.12", "xlsm"},
	{"ppt", Type{MIME: "application/vnd.openxmlformats-officedocument.presentationml.presentation", Class: ClassOffice, Ext: "pptx"},
		"application/vnd.ms-powerpoint.presentation.macroEnabled.12", "pptm"},
}

// zipText reads a small entry of z, "" when it cannot.
func zipText(z *zip.Reader, name string) string {
	f, err := z.Open(name)
	if err != nil {
		return ""
	}
	defer func() { _ = f.Close() }()
	b, err := io.ReadAll(io.LimitReader(f, 128))
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(b))
}

// cfbMagic starts a compound file: Word, Excel and PowerPoint before 2007, an Outlook message, and
// a Windows installer.
var cfbMagic = []byte{0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1}

// cfbClasses are the root entry's class ids a compound file names its application by, as the
// sixteen bytes it stores them in.
var cfbClasses = map[[16]byte]Type{
	clsid(0x000C1084, 0, 0, 0xC0, 0x46): {MIME: "application/x-msi", Class: ClassBlocked},
	clsid(0x000C1086, 0, 0, 0xC0, 0x46): {MIME: "application/x-msi", Class: ClassBlocked},
	clsid(0x00020906, 0, 0, 0xC0, 0x46): {MIME: "application/msword", Class: ClassOffice, Ext: "doc"},
	clsid(0x00020820, 0, 0, 0xC0, 0x46): {MIME: "application/vnd.ms-excel", Class: ClassOffice, Ext: "xls"},
	clsid(0x00020810, 0, 0, 0xC0, 0x46): {MIME: "application/vnd.ms-excel", Class: ClassOffice, Ext: "xls"},
}

// clsid is the class id {d1-0000-0000-hi00-0000000000lo} as a compound file stores it: its first
// three fields little-endian.
func clsid(d1 uint32, d2, d3 uint16, hi, lo byte) [16]byte {
	var c [16]byte
	binary.LittleEndian.PutUint32(c[0:], d1)
	binary.LittleEndian.PutUint16(c[4:], d2)
	binary.LittleEndian.PutUint16(c[6:], d3)
	c[8], c[15] = hi, lo
	return c
}

// cfbStreams name a compound file's application by a stream its first directory sector holds,
// where its root entry names none.
var cfbStreams = map[string]Type{
	"WordDocument":        {MIME: "application/msword", Class: ClassOffice, Ext: "doc"},
	"Workbook":            {MIME: "application/vnd.ms-excel", Class: ClassOffice, Ext: "xls"},
	"Book":                {MIME: "application/vnd.ms-excel", Class: ClassOffice, Ext: "xls"},
	"PowerPoint Document": {MIME: "application/vnd.ms-powerpoint", Class: ClassOffice, Ext: "ppt"},
}

// sniffCFB reads a compound file's first directory sector: its root entry's class, then its
// streams' names.
func sniffCFB(r io.ReaderAt) Type {
	unknown := Type{MIME: "application/x-ole-storage", Class: ClassBinary}
	header := make([]byte, 0x34)
	if _, err := r.ReadAt(header, 0); err != nil {
		return unknown
	}
	shift := binary.LittleEndian.Uint16(header[0x1E:])
	if shift != 9 && shift != 12 {
		return unknown
	}
	sectorSize := int64(1) << shift
	first := int64(binary.LittleEndian.Uint32(header[0x30:]))
	dir := make([]byte, sectorSize)
	if _, err := r.ReadAt(dir, (first+1)*sectorSize); err != nil {
		return unknown
	}
	var root [16]byte
	copy(root[:], dir[0x50:0x60])
	if t, ok := cfbClasses[root]; ok {
		return t
	}
	for e := 0; e+128 <= len(dir); e += 128 {
		n := int(binary.LittleEndian.Uint16(dir[e+0x40:]))
		if n < 2 || n > 64 {
			continue
		}
		units := make([]uint16, n/2-1)
		for i := range units {
			units[i] = binary.LittleEndian.Uint16(dir[e+2*i:])
		}
		if t, ok := cfbStreams[string(utf16.Decode(units))]; ok {
			return t
		}
	}
	return unknown
}

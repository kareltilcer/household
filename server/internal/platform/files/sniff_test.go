package files

import (
	"archive/zip"
	"bytes"
	"encoding/binary"
	"io"
	"strconv"
	"strings"
	"testing"
	"unicode/utf16"

	"github.com/kareltilcer/household/server/internal/platform/objectstore"
)

// zipped is a ZIP holding an entry for each of names, the first stored with body when it is
// "mimetype".
func zipped(t *testing.T, body string, names ...string) []byte {
	t.Helper()
	var buf bytes.Buffer
	z := zip.NewWriter(&buf)
	for _, n := range names {
		w, err := z.Create(n)
		if err != nil {
			t.Fatal(err)
		}
		if n == "mimetype" {
			if _, err := w.Write([]byte(body)); err != nil {
				t.Fatal(err)
			}
		}
	}
	if err := z.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

// compound is a compound file of 512-byte sectors whose directory, in the first sector after the
// header, has a root entry of class id root and one stream named stream.
func compound(root [16]byte, stream string) []byte {
	out := make([]byte, 1024)
	copy(out, cfbMagic)
	binary.LittleEndian.PutUint16(out[0x1E:], 9)
	binary.LittleEndian.PutUint32(out[0x30:], 0)
	dir := out[512:]
	name := utf16.Encode([]rune("Root Entry"))
	for i, u := range name {
		binary.LittleEndian.PutUint16(dir[2*i:], u)
	}
	binary.LittleEndian.PutUint16(dir[0x40:], uint16(2*len(name)+2)) //nolint:gosec // G115: a name of a few characters.
	copy(dir[0x50:], root[:])
	entry := dir[128:]
	name = utf16.Encode([]rune(stream))
	for i, u := range name {
		binary.LittleEndian.PutUint16(entry[2*i:], u)
	}
	binary.LittleEndian.PutUint16(entry[0x40:], uint16(2*len(name)+2)) //nolint:gosec // G115: a name of a few characters.
	return out
}

// ftyp is an ISO media file's first box, with major brand and compatible brands.
func ftyp(major string, compatible ...string) []byte {
	body := []byte(major + "\x00\x00\x00\x00" + strings.Join(compatible, ""))
	out := make([]byte, 8, 8+len(body)+16)
	binary.BigEndian.PutUint32(out, uint32(8+len(body))) //nolint:gosec // G115: a box of a few brands.
	copy(out[4:], "ftyp")
	return append(append(out, body...), make([]byte, 16)...)
}

// A macro-enabled document is the macro-enabled kind by its extension as well as its type, as it is
// sniffed and as it is read back from what it was stored as: the converter is told the document's
// kind by the extension, and one it is told is plain is not the document it is sent.
func TestAMacroEnabledDocumentKeepsItsExtension(t *testing.T) {
	for _, tc := range []struct {
		dir, ext string
	}{{"word", "docm"}, {"xl", "xlsm"}, {"ppt", "pptm"}} {
		content := zipped(t, "", "[Content_Types].xml", tc.dir+"/document.xml", tc.dir+"/vbaProject.bin")
		got := Sniff(bytes.NewReader(content), int64(len(content)), "")
		if got.Ext != tc.ext || got.Class != ClassOffice {
			t.Errorf("%s with macros: %+v, want the extension %s", tc.dir, got, tc.ext)
		}
		if stored := typeOf(got.MIME); stored != got {
			t.Errorf("%s with macros, as stored: %+v, want %+v", tc.dir, stored, got)
		}
	}
}

// Every type is sniffed from the bytes: a name makes no type, it only says which kind of text text
// is, and blocks a program whatever its bytes are.
func TestSniff(t *testing.T) {
	for _, tc := range []struct {
		name     string
		content  []byte
		filename string
		mime     string
		class    Class
	}{
		{"jpeg", []byte("\xff\xd8\xff\xe0\x00\x10JFIF"), "photo.heic", "image/jpeg", ClassRaster},
		{"png", []byte("\x89PNG\r\n\x1a\n\x00\x00"), "", "image/png", ClassRaster},
		{"gif", []byte("GIF89a\x01\x00"), "", "image/gif", ClassRaster},
		{"webp", []byte("RIFF\x00\x00\x00\x00WEBPVP8 "), "", "image/webp", ClassRaster},
		{"bmp", append([]byte("BM\x46\x00\x00\x00\x00\x00\x00\x00"), make([]byte, 8)...), "", "image/bmp", ClassRaster},
		{"text that starts BM", []byte("BMW service booklet, 2019 to 2024"), "notes.txt", "text/plain; charset=utf-8", ClassText},
		{"tiff", []byte("II*\x00\x08\x00\x00\x00"), "", "image/tiff", ClassRaster},
		{"heic", ftyp("heic", "mif1", "heic"), "", "image/heic", ClassPicture},
		{"heif", ftyp("mif1", "mif1"), "", "image/heif", ClassPicture},
		{"avif", ftyp("avif", "mif1", "avif"), "", "image/avif", ClassPicture},
		{"mp4", ftyp("isom", "isom", "avc1"), "", "video/mp4", ClassMedia},
		{"quicktime", ftyp("qt  ", "qt  "), "", "video/quicktime", ClassMedia},
		{"m4a", ftyp("M4A ", "M4A ", "isom"), "", "audio/mp4", ClassMedia},
		{"pdf", []byte("%PDF-1.7\n%âãÏÓ\n"), "", "application/pdf", ClassPDF},
		{"pdf after junk", append(bytes.Repeat([]byte{0}, 100), []byte("%PDF-1.4")...), "", "application/pdf", ClassPDF},
		{"rtf", []byte(`{\rtf1\ansi Hello}`), "", "application/rtf", ClassOffice},
		{"docx", zipped(t, "", "[Content_Types].xml", "_rels/.rels", "word/document.xml"), "letter.pdf",
			"application/vnd.openxmlformats-officedocument.wordprocessingml.document", ClassOffice},
		{"xlsx", zipped(t, "", "[Content_Types].xml", "xl/workbook.xml"), "",
			"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ClassOffice},
		{"pptm", zipped(t, "", "[Content_Types].xml", "ppt/presentation.xml", "ppt/vbaProject.bin"), "",
			"application/vnd.ms-powerpoint.presentation.macroEnabled.12", ClassOffice},
		{"odt", zipped(t, "application/vnd.oasis.opendocument.text", "mimetype", "content.xml"), "",
			"application/vnd.oasis.opendocument.text", ClassOffice},
		{"epub", zipped(t, "application/epub+zip", "mimetype", "OEBPS/content.opf"), "", "application/epub+zip", ClassBinary},
		{"zip", zipped(t, "", "photos/1.jpg", "photos/2.jpg"), "", "application/zip", ClassArchive},
		{"jar", zipped(t, "", "META-INF/MANIFEST.MF", "App.class"), "app.zip", "application/java-archive", ClassBlocked},
		{"apk", zipped(t, "", "AndroidManifest.xml", "classes.dex"), "", "application/java-archive", ClassBlocked},
		{"doc", compound(clsid(0x00020906, 0, 0, 0xC0, 0x46), "WordDocument"), "", "application/msword", ClassOffice},
		{"xls by its stream", compound([16]byte{}, "Workbook"), "", "application/vnd.ms-excel", ClassOffice},
		{"ppt by its stream", compound([16]byte{}, "PowerPoint Document"), "", "application/vnd.ms-powerpoint", ClassOffice},
		{"msi", compound(clsid(0x000C1084, 0, 0, 0xC0, 0x46), "\u4840\u3f3f"), "setup.doc", "application/x-msi", ClassBlocked},
		{"another compound file", compound([16]byte{}, "__substg1.0_0037001F"), "", "application/x-ole-storage", ClassBinary},
		{"windows program", append([]byte("MZ\x90\x00\x03\x00\x00\x00"), make([]byte, 60)...), "", "application/vnd.microsoft.portable-executable", ClassBlocked},
		{"text that starts MZ", []byte("MZ Autodoprava, faktura 12"), "", "text/plain; charset=utf-8", ClassText},
		{"elf", []byte("\x7fELF\x02\x01\x01\x00"), "", "application/x-elf", ClassBlocked},
		{"mach-o", []byte("\xcf\xfa\xed\xfe\x07\x00\x00\x01"), "", "application/x-mach-binary", ClassBlocked},
		{"script", []byte("#!/bin/sh\nrm -rf ~\n"), "readme.txt", "text/x-shellscript", ClassBlocked},
		{"a program by its name", []byte("%PDF-1.7\n"), "invoice.pdf.EXE", "application/octet-stream", ClassBlocked},
		{"a script by its name", []byte("WScript.Echo 1"), "run.vbs", "application/octet-stream", ClassBlocked},
		// Saved on Windows, a name loses the dots and spaces it ends with.
		{"a script by its name, dots after it", []byte("@echo off\n"), "run.bat.", "application/octet-stream", ClassBlocked},
		{"a script by its name, a dot and a space after it", []byte("@echo off\n"), "run.bat. ", "application/octet-stream", ClassBlocked},
		{"a console by its name", []byte(`<?xml version="1.0"?><MMC_ConsoleFile/>`), "tool.msc", "application/octet-stream", ClassBlocked},
		{"a macOS script by its name", []byte("open -a Calculator\n"), "start.command", "application/octet-stream", ClassBlocked},
		{"compiled help by its name", []byte("ITSF\x03\x00\x00\x00\x60\x00\x00\x00"), "Invoice.CHM", "application/octet-stream", ClassBlocked},
		{"a Java Web Start launch by its name", []byte(`<?xml version="1.0"?><jnlp spec="1.0+"/>`), "app.jnlp", "application/octet-stream", ClassBlocked},
		{"a disk image by its name", append([]byte{0, 0, 0, 0}, []byte("CD001")...), "photos.iso", "application/octet-stream", ClassBlocked},
		{"a name that only ends in dots", []byte("Milk, eggs\n"), "list...", "text/plain; charset=utf-8", ClassText},
		{"html", []byte("<!DOCTYPE html><html><body>hi</body></html>"), "page.txt", "text/html", ClassActive},
		{"html deep in text", []byte("Dear Jana,\n\nsee <script>alert(1)</script>"), "letter.txt", "text/html", ClassActive},
		{"svg", []byte(`<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>`), "plan.png", "image/svg+xml", ClassActive},
		{"svg without a declaration", []byte(`<svg xmlns="http://www.w3.org/2000/svg"></svg>`), "", "image/svg+xml", ClassActive},
		{"svg in utf-16", append([]byte{0xFF, 0xFE}, utf16le(`<svg xmlns="http://www.w3.org/2000/svg"/>`)...), "", "image/svg+xml", ClassActive},
		{"xml", []byte(`<?xml version="1.0"?><note>milk</note>`), "", "application/xml", ClassActive},
		{"text", []byte("Milk, eggs, bread\n"), "", "text/plain; charset=utf-8", ClassText},
		{"csv", []byte("date,amount\n2026-09-30,120\n"), "Výpis.CSV", "text/csv; charset=utf-8", ClassText},
		{"json", []byte(`{"milk": 2}`), "list.json", "application/json", ClassText},
		{"a name that makes text no image", []byte("Milk, eggs\n"), "list.png", "text/plain; charset=utf-8", ClassText},
		{"mp3", []byte("ID3\x03\x00\x00\x00\x00\x00\x00"), "", "audio/mpeg", ClassMedia},
		{"gzip", []byte("\x1f\x8b\x08\x00"), "", "application/gzip", ClassArchive},
		{"unknown bytes", []byte{0x00, 0x01, 0x02, 0x03, 0xfe}, "data.txt", "application/octet-stream", ClassBinary},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := Sniff(bytes.NewReader(tc.content), int64(len(tc.content)), tc.filename)
			if got.MIME != tc.mime || got.Class != tc.class {
				t.Fatalf("Sniff = %s (%s), want %s (%s)", got.MIME, got.Class, tc.mime, tc.class)
			}
		})
	}
}

// countingReader counts the bytes read through it.
type countingReader struct {
	r    io.ReaderAt
	read int64
}

func (c *countingReader) ReadAt(p []byte, off int64) (int, error) {
	n, err := c.r.ReadAt(p, off)
	c.read += int64(n)
	return n, err
}

// A ZIP whose directory lists more than the sniffer reads is an archive, known without reading the
// rest of it: zip.NewReader would hold every entry it lists. One listed in full is still known by
// its entries.
func TestAZipsDirectoryIsReadSoFar(t *testing.T) {
	names := make([]string, 0, 100_001)
	for i := range 100_000 {
		names = append(names, strconv.Itoa(i))
	}
	many := zipped(t, "", append(names, "META-INF/MANIFEST.MF")...)
	if len(many) < maxZipDirectory {
		t.Fatalf("the ZIP is %d bytes, too few to try the bound", len(many))
	}
	c := &countingReader{r: bytes.NewReader(many)}
	if got := Sniff(c, int64(len(many)), "photos.zip"); got.MIME != "application/zip" || got.Class != ClassArchive {
		t.Fatalf("Sniff = %s (%s)", got.MIME, got.Class)
	}
	if c.read > maxZipDirectory+sniffLen {
		t.Fatalf("read %d bytes of a ZIP to sniff it", c.read)
	}
	few := zipped(t, "", append(names[:1000], "META-INF/MANIFEST.MF")...)
	if got := Sniff(bytes.NewReader(few), int64(len(few)), "photos.zip"); got.Class != ClassBlocked {
		t.Fatalf("a JAR of a thousand entries is %s (%s)", got.MIME, got.Class)
	}
}

func utf16le(s string) []byte {
	var out []byte
	for _, u := range utf16.Encode([]rune(s)) {
		out = binary.LittleEndian.AppendUint16(out, u)
	}
	return out
}

// A type is shown in place only where a browser shows it safely; everything active, and everything
// it does not show, is saved (FR-FL2). A stored type is read back as the class it was sniffed as.
func TestATypeIsPresentedByItsClass(t *testing.T) {
	for mime, want := range map[string]objectstore.Disposition{
		"image/jpeg": objectstore.Inline, "image/heic": objectstore.Inline, "application/pdf": objectstore.Inline,
		"text/plain; charset=utf-8": objectstore.Inline, "video/mp4": objectstore.Inline,
		"image/svg+xml": objectstore.Attachment, "text/html": objectstore.Attachment, "application/xml": objectstore.Attachment,
		"application/vnd.openxmlformats-officedocument.wordprocessingml.document": objectstore.Attachment,
		"application/zip": objectstore.Attachment, "application/octet-stream": objectstore.Attachment,
		"application/x-something-new": objectstore.Attachment,
	} {
		if got := typeOf(mime).Disposition(); got != want {
			t.Errorf("%s: %s, want %s", mime, got, want)
		}
	}
	if !typeOf("application/msword").Derives() || typeOf("application/msword").Ext != "doc" || typeOf("image/heic").Derives() {
		t.Error("a stored type does not derive as it was sniffed")
	}
}

// A client's name for a file is saved as its last element, without what could spoof or break it.
func TestCleanName(t *testing.T) {
	for in, want := range map[string]string{
		"záhon.png":                          "záhon.png",
		`C:\Users\jana\Zahrada\záhon.png`:    "záhon.png",
		"../../etc/passwd":                   "passwd",
		"  Smlouva ČEZ.pdf  ":                "Smlouva ČEZ.pdf",
		"invoice\u202efdp.exe":               "invoicefdp.exe",
		"line\nbreak.txt":                    "linebreak.txt",
		"\xff\xfebad.txt":                    "\uFFFDbad.txt",
		"..":                                 "",
		"":                                   "",
		"/":                                  "",
		strings.Repeat("a", 300) + ".pdf":    strings.Repeat("a", 251) + ".pdf",
		strings.Repeat("é", 300) + ".tar.gz": strings.Repeat("é", 252) + ".gz",
	} {
		if got := cleanName(in); got != want {
			t.Errorf("cleanName(%q) = %q, want %q", in, got, want)
		}
	}
}

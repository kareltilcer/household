# The converter sidecar (plan item 14, ADR 0015): LibreOffice headless, which turns an office
# document into a PDF, and poppler's pdftoppm, which draws a PDF's first page, behind the small HTTP
# server in server/cmd/converter. The files pipeline derives a document's variants through it
# (internal/platform/convert). It is built from the repository's root, whose .dockerignore lets in
# the Go module it builds from and nothing else:
#
#   docker build --file deploy/converter/Dockerfile --tag household-converter .
#
# Run it with no route out: a document may name remote resources, which LibreOffice would fetch.

FROM golang:1.26.9-trixie AS build
WORKDIR /src
# The modules server/go.mod replaces with directories beside it: their go.mod is all the build reads.
COPY docs/api/go.mod docs/api/
COPY packages/i18n/go.mod packages/i18n/
COPY reference-data/go.mod reference-data/
COPY server/go.mod server/go.sum server/
RUN cd server && go mod download
COPY server/ server/
RUN cd server && CGO_ENABLED=0 go build -trimpath -ldflags=-s -o /converter ./cmd/converter

FROM debian:trixie-slim
# The office suite without its desktop, poppler, and fonts metric-compatible with the ones
# documents name most: Liberation for Arial, Times New Roman and Courier New, Carlito and Caladea
# for Calibri and Cambria, DejaVu for what else there is.
RUN apt-get update \
  && apt-get install --yes --no-install-recommends \
    libreoffice-writer-nogui libreoffice-calc-nogui libreoffice-impress-nogui libreoffice-draw-nogui \
    poppler-utils fonts-liberation2 fonts-crosextra-carlito fonts-crosextra-caladea fonts-dejavu-core \
  && rm -rf /var/lib/apt/lists/* \
  && useradd --system --uid 10001 --home-dir /nonexistent --shell /usr/sbin/nologin converter
COPY --from=build /converter /usr/local/bin/converter
USER converter
ENV HOUSEHOLD_CONVERTER_ADDR=0.0.0.0:3100
EXPOSE 3100
HEALTHCHECK --interval=5s --timeout=5s --retries=30 CMD ["/usr/local/bin/converter", "check"]
ENTRYPOINT ["/usr/local/bin/converter"]

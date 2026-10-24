FROM golang:1.25-bookworm AS build
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /rivet ./cmd/rivet-server

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /rivet /rivet
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s CMD ["/rivet", "healthcheck"]
ENTRYPOINT ["/rivet"]

ARG MINIO_SOURCE_REF=7aac2a2c5b7c882e68c1ce017d8256be2feea27f

FROM golang:1.24-alpine AS build
ARG MINIO_SOURCE_REF
ENV CGO_ENABLED=0
RUN apk add --no-cache ca-certificates git
RUN GOBIN=/out go install github.com/minio/minio@${MINIO_SOURCE_REF}

FROM alpine:3.22
RUN apk add --no-cache ca-certificates
COPY --from=build /out/minio /usr/local/bin/minio
RUN addgroup -S minio && adduser -S -G minio minio && mkdir -p /data && chown -R minio:minio /data
USER minio
EXPOSE 9000 9001
VOLUME ["/data"]
ENTRYPOINT ["/usr/local/bin/minio"]
CMD ["server","/data","--console-address",":9001"]

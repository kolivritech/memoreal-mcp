FROM alpine:3.20
RUN apk add --no-cache bash curl jq git
WORKDIR /app
COPY . /app
ENV MEMORIA_URL="https://memoria.kolivri.com/v1/mcp"
ENTRYPOINT ["sh", "-c", "exec ./install.sh"]

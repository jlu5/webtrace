# webtrace

**webtrace** is a looking glass utility: a web frontend for traceroute, ping, and mtr. It uses [readable streams](https://developer.mozilla.org/en-US/docs/Web/API/Streams_API/Using_readable_streams) to pipe live output straight to the browser.

[Demo](https://webtrace-demo.highdef.network/)

## Configuration

webtrace accepts some config options via environment variables:

- `WEBTRACE_MTRCOUNT` - number of mtr cycles to run (default 10)
- `WEBTRACE_PINGCOUNT` - number of pings to send in ping mode (default 4)
- `WEBTRACE_RATELIMIT` - rate limit of calls per IP, via [Flask-Limiter](https://flask-limiter.readthedocs.io/en/stable/) (default "10/minute")
- `WEBTRACE_SERVERINFO` - optional server description to insert into the site
- `WEBTRACE_TITLE` - web page title (default "webtrace")
- `WEBTRACE_TIMEOUT` - timeout for requests in seconds (default 30)

## Install

webtrace is a Flask app, and there are [many ways to deploy](https://flask.palletsprojects.com/en/3.0.x/deploying/) them - below are some examples. **The only requirement is a web server that supports streaming** (i.e. with response buffering disabled).

webtrace's entrypoint is [`app:app`](app.py).

### Gunicorn (Linux)

To run webtrace with Gunicorn, you MUST enable asynchronous workers (`gunicorn app:app` **`-k gevent`**). Otherwise, only one request can be served at once, across the whole instance. For the rest, you can follow [Gunicorn's official deployment guide](https://docs.gunicorn.org/en/stable/deploy.html).

There are some examples of systemd services to start webtrace in the [`deploy-examples/gunicorn`](deploy-examples/gunicorn) folder.

### Waitress (cross-platform)

webtrace works out of the box with [Waitress](https://flask.palletsprojects.com/en/3.0.x/deploying/waitress/). Although the Flask setup guide suggests that Waitress doesn't support streaming, this worked fine in my testing on both Linux and Windows.

Example: `waitress-serve --host 127.0.0.1 app:app`

### Reverse proxy with nginx

A common recommendation is to run the WSGI server behind a reverse proxy. This works well with nginx: just make sure to set `proxy_buffering off;`

```
upstream webtrace-backend {
    server unix:/run/webtrace.sock;
}

server {
    listen 80;
    listen [::]:80;
    #listen 443 ssl;
    #listen [::]:443 ssl;

    server_name your.server.name;

    # Alternatively, "location /" if you want webtrace at the root of the domain
    location /webtrace/ {
        proxy_pass http://webtrace-backend/;
        # Important since we use HTTP streaming!
        proxy_buffering off;
        access_log /var/log/nginx/webtrace-access.log;
        error_log /var/log/nginx/webtrace-error.log;
    }
}
```

### IIS + wfastcgi (Windows)

(I ported webtrace to Windows mostly for proof-of-concept; this is not thoroughly supported. Last tested on Server 2019 and Python 3.12)

[Muhammad Tauseeq's "Deploy a Flask app on Windows Server using FastCGI and IIS"](https://mtuseeq.medium.com/how-to-deploy-flask-app-on-windows-server-using-fastcgi-and-iis-73d8139d5342) guide covers pretty much everything. There is a sample `web.config` file in the [`deploy-examples/iis-wfastcgi`](deploy-examples/iis-wfastcgi) folder; this should be copied into the folder you clone the webtrace repo into. `responseBufferLimit="0"` is important to turn off response buffering.

IIS has other ways of running CGI apps such as [HttpPlatformHandler](https://www.iis.net/downloads/microsoft/httpplatformhandler) and [ARR Reverse Proxying](https://learn.microsoft.com/en-us/iis/extensions/url-rewrite-module/reverse-proxy-with-url-rewrite-v2-and-application-request-routing), but these do not appear to support unbuffered responses. As a result, webtrace will not work with those setups.

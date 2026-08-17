from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class AppHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith(("/home", "/details/", "/watch/")):
            self.path = "/index.html"
        return super().do_GET()


ThreadingHTTPServer(("0.0.0.0", 3000), AppHandler).serve_forever()

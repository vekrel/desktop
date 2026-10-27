// app.vekrel.com was the hosted app's first address; keep old links working.
export default {
  fetch(request) {
    const url = new URL(request.url);
    url.hostname = "rc.vekrel.com";
    return Response.redirect(url.toString(), 301);
  },
};

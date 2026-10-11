// Externalised from the inline block of overview.html (SAFE-02 / D-13-03, plan 13-10) - moved verbatim, same position.
(function () {
    // Bridge: the embedded deck posts {type:'deck-overlay', open} whenever one of the
    // three layer overlays opens/closes; expand the iframe to full-screen so the
    // popover covers the whole window (over the app header + sidebar).
    //
    // [security] WR-B03 (Phase 13 review, Part B): only the first-party deck frame
    // may drive this relay. A message is ignored unless it comes from this origin
    // AND from the #deckframe window itself - a cross-origin opener holding a
    // WindowProxy, or any slide frame (incl. sandboxed opaque-origin uploads), can
    // no longer toggle the full-window overlay or open an attacker-labelled slide.
    // `open-slide` is further limited to a first-party deck page path, so even the
    // deck cannot point the overlay's "Open in new tab" link off-portal.
    var OPEN_SLIDE_PATH = /^\/overview-deck\/[\w.-]+\.html$/;
    window.addEventListener('message', function (e) {
      var df = document.getElementById('deckframe');
      if (!e || e.origin !== window.location.origin || !df || e.source !== df.contentWindow) return;
      var d = e.data;
      if (d && d.type === 'deck-overlay') {
        document.body.classList.toggle('deck-fullscreen', !!d.open);
      } else if (d && d.type === 'open-slide' && typeof d.url === 'string' && OPEN_SLIDE_PATH.test(d.url) && window.openHtmlSlide) {
        // The deck's "Agenda" button asks us to open a standalone slide full-screen.
        window.openHtmlSlide(d.url, typeof d.label === 'string' && d.label ? d.label : 'Slide');
      }
    });
})();

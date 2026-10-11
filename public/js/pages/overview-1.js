// Externalised from the inline block of overview.html (SAFE-02 / D-13-03, plan 13-10) - moved verbatim, same position.
(function () {
    // Bridge: the embedded deck posts {type:'deck-overlay', open} whenever one of the
    // three layer overlays opens/closes; expand the iframe to full-screen so the
    // popover covers the whole window (over the app header + sidebar).
    window.addEventListener('message', function (e) {
      var d = e && e.data;
      if (d && d.type === 'deck-overlay') {
        document.body.classList.toggle('deck-fullscreen', !!d.open);
      } else if (d && d.type === 'open-slide' && d.url && window.openHtmlSlide) {
        // The deck's "Agenda" button asks us to open a standalone slide full-screen.
        window.openHtmlSlide(d.url, d.label || 'Slide');
      }
    });
})();

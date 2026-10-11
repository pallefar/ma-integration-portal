// Externalised from the inline block of playbook.html (SAFE-02 / D-13-03, plan 13-10) - moved verbatim, same position.
(function () {
    document.addEventListener('DOMContentLoaded', () => {
      const sections = document.querySelectorAll('.playbook-section');
      const tocLinks = document.querySelectorAll('.playbook-toc-link');

      function showSection(id) {
        sections.forEach(sec => {
          if (sec.getAttribute('id') === id) {
            sec.style.display = 'block';
            sec.classList.add('active');
          } else {
            sec.style.display = 'none';
            sec.classList.remove('active');
          }
        });

        tocLinks.forEach(link => {
          if (link.getAttribute('href') === `#${id}`) {
            link.classList.add('active');
          } else {
            link.classList.remove('active');
          }
        });
      }

      // Check URL hash on load
      let initialId = 'intro';
      const hash = window.location.hash.substring(1);
      if (hash && document.getElementById(hash)) {
        initialId = hash;
      }
      showSection(initialId);

      // Handle sidebar TOC clicks
      tocLinks.forEach(link => {
        link.addEventListener('click', (e) => {
          e.preventDefault();
          const id = link.getAttribute('href').substring(1);
          showSection(id);
          // Update URL hash without scrolling the page
          history.pushState(null, null, `#${id}`);
        });
      });
      
      // Listen for hash change (e.g. back/forward browser buttons)
      window.addEventListener('hashchange', () => {
        const hash = window.location.hash.substring(1);
        if (hash && document.getElementById(hash)) {
          showSection(hash);
        }
      });
    });
})();

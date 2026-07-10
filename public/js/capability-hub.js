document.addEventListener('DOMContentLoaded', () => {
  // Navigation ScrollSpy for TOC
  const sections = document.querySelectorAll('.playbook-section');
  const navLinks = document.querySelectorAll('.playbook-toc-link');

  window.addEventListener('scroll', () => {
    let current = '';
    sections.forEach(section => {
      const sectionTop = section.offsetTop;
      const sectionHeight = section.clientHeight;
      if (scrollY >= (sectionTop - 150)) {
        current = section.getAttribute('id');
      }
    });

    navLinks.forEach(link => {
      link.classList.remove('active');
      // Only highlight when a section is actually in view — `includes('')` is always
      // true, which would light up every TOC link while scrolled above the first section.
      if (current && link.getAttribute('href').includes(current)) {
        link.classList.add('active');
      }
    });
  });

  // Launch Assessment Wizard
  const btnLaunch = document.getElementById('btn-launch-assessment');
  const wizardContainer = document.getElementById('assessment-wizard-container');
  
  if (btnLaunch && wizardContainer) {
    btnLaunch.addEventListener('click', () => {
      if (wizardContainer.style.display === 'none') {
        wizardContainer.style.display = 'block';
        btnLaunch.textContent = 'Close Assessment Wizard';
      } else {
        wizardContainer.style.display = 'none';
        btnLaunch.textContent = 'Launch Assessment Wizard';
      }
    });
  }
});

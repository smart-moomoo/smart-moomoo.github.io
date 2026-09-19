// The profile and navigation remain usable without JavaScript.
document.getElementById('year').textContent = new Date().getFullYear();

const navigation = [...document.querySelectorAll('nav a')];
const sections = navigation
  .map(link => document.querySelector(link.getAttribute('href')))
  .filter(Boolean)
  .sort((a, b) => a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);

function updateNavigation() {
  let current = sections[0];
  for (const section of sections) {
    if (section.getBoundingClientRect().top <= 150) current = section;
  }
  // Short final sections cannot always reach the top of the viewport.
  if (window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2) {
    current = sections[sections.length - 1];
  }
  for (const link of navigation) {
    if (link.getAttribute('href') === `#${current.id}`) {
      link.setAttribute('aria-current', 'location');
    } else {
      link.removeAttribute('aria-current');
    }
  }
}

let scheduled = false;
window.addEventListener('scroll', () => {
  if (scheduled) return;
  scheduled = true;
  window.requestAnimationFrame(() => {
    updateNavigation();
    scheduled = false;
  });
}, { passive: true });
window.addEventListener('resize', updateNavigation);
window.addEventListener('pageshow', updateNavigation);
updateNavigation();

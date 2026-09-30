// The kids and their pages. Change names and icons here;
// the menu on every page uses this list.
window.KIDS = [
  { name: 'Alexia', icon: '🧛', page: 'alexia.html' },
  { name: 'Lukas', icon: '🧙', page: 'lukas.html' },
  { name: 'Olesia', icon: '🧟', page: 'olesia.html' },
  { name: 'Oleksii', icon: '👻', page: 'oleksii.html' },
];

(function () {
  const current = decodeURIComponent(
    location.pathname.split('/').pop() || 'index.html',
  );

  function link(href, html, cls) {
    const a = document.createElement('a');
    a.href = href;
    a.className = cls;
    a.innerHTML = html;
    if (href === current) a.classList.add('active');
    return a;
  }

  function render() {
    const nav = document.getElementById('menu');
    if (nav) {
      nav.appendChild(link('index.html', '🏠', 'menu-link home'));
      window.KIDS.forEach(k =>
        nav.appendChild(
          link(k.page, `<span>${k.icon}</span> ${k.name}`, 'menu-link'),
        ),
      );
    }
    const big = document.getElementById('kid-picker');
    if (big) {
      window.KIDS.forEach(k =>
        big.appendChild(
          link(
            k.page,
            `<span class="pick-icon">${k.icon}</span>` +
              `<span class="pick-name">${k.name}</span>`,
            'pick',
          ),
        ),
      );
    }
  }

  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', render);
  else render();
})();

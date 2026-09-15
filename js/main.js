(function () {
    const header = document.querySelector('header');
    const hamburger = document.querySelector('.hamburger');
    const navLinks = document.querySelectorAll('nav a');
    const backToTop = document.querySelector('.back-to-top');
    const skipLink = document.querySelector('.skip-to-content');

    if (hamburger) {
        hamburger.addEventListener('click', () => header.classList.toggle('nav-open'));
    }

    navLinks.forEach(link => {
        link.addEventListener('click', () => header.classList.remove('nav-open'));
    });

    if (skipLink) {
        skipLink.addEventListener('click', (e) => {
            e.preventDefault();
            const target = document.getElementById(skipLink.getAttribute('href').slice(1));
            if (target) target.scrollIntoView({ behavior: 'smooth' });
        });
    }

    const animatedElements = document.querySelectorAll('.animate-on-scroll');
    if (animatedElements.length) {
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('visible');
                    observer.unobserve(entry.target);
                }
            });
        }, { threshold: 0.15 });
        animatedElements.forEach(el => observer.observe(el));
    }

    if (backToTop) {
        window.addEventListener('scroll', () => {
            backToTop.classList.toggle('visible', window.scrollY > 400);
        });
        backToTop.addEventListener('click', () => {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    }
})();

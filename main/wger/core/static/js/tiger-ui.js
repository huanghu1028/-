/*
 * tiger-减脂 UI helpers (vanilla JS, no build step, loaded with defer).
 *
 * 1. Mobile sidebar drawer (#appSidebar): auto-close after a nav link is
 *    clicked. Desktop is unaffected: the responsive offcanvas only has a
 *    shown instance below the md breakpoint.
 * 2. Back-to-top button (#tigerBackTop): hidden by default, shown after
 *    scrolling more than 400px, smooth-scrolls to the top on click.
 */
(function () {
    'use strict';

    /* ---------- 1. mobile drawer auto-close ---------- */
    var sidebar = document.getElementById('appSidebar');

    if (sidebar) {
        sidebar.addEventListener('click', function (event) {
            var target = event.target;
            if (!target || !target.closest || !target.closest('.nav-link')) {
                return;
            }
            if (!window.bootstrap || !window.bootstrap.Offcanvas) {
                return;
            }
            var drawer = window.bootstrap.Offcanvas.getInstance(sidebar);
            if (drawer && sidebar.classList.contains('show')) {
                drawer.hide();
            }
        });
    }

    /* ---------- 2. back-to-top button ---------- */
    var backTop = document.getElementById('tigerBackTop');

    if (backTop) {
        var SHOW_THRESHOLD = 400;
        var ticking = false;

        var updateVisibility = function () {
            backTop.classList.toggle('is-visible', window.scrollY > SHOW_THRESHOLD);
            ticking = false;
        };

        window.addEventListener('scroll', function () {
            if (!ticking) {
                ticking = true;
                window.requestAnimationFrame(updateVisibility);
            }
        }, { passive: true });

        backTop.addEventListener('click', function () {
            var reduceMotion = window.matchMedia &&
                window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
        });

        /* Set the initial state (page may load already scrolled, e.g. via #anchor) */
        updateVisibility();
    }
})();
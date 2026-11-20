/*
 * tiger-减脂 visual effects wiring (vanilla JS, no build step, loaded with defer).
 *
 * Drives three vendored MIT libraries (static/vendor/):
 *   AOS           - reveal-on-scroll for [data-aos] elements (landing page)
 *   countUp.js    - animated counters for [data-countup] elements
 *   vanilla-tilt  - 3D tilt for [data-tilt] elements
 * Everything is feature-detected and skipped under prefers-reduced-motion,
 * so pages without the attributes or without the libs are unaffected.
 */
(function () {
    'use strict';

    var reduceMotion = window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function ready(fn) {
        if (document.readyState !== 'loading') {
            fn();
        } else {
            document.addEventListener('DOMContentLoaded', fn);
        }
    }

    ready(function () {
        /* ---------- 1. scroll reveal ---------- */
        if (window.AOS && document.querySelector('[data-aos]')) {
            window.AOS.init({
                once: true,
                duration: 650,
                easing: 'ease-out-cubic',
                offset: 60,
                disable: reduceMotion
            });
        }

        /* ---------- 2. number counters ---------- */
        var nums = document.querySelectorAll('[data-countup]');
        if (nums.length && window.countUp && window.countUp.CountUp) {
            var startCounter = function (el) {
                var target = parseFloat(el.getAttribute('data-countup')) || 0;
                var counter = new window.countUp.CountUp(el, target, {
                    duration: 2,
                    separator: ','
                });
                if (!counter.error) {
                    counter.start();
                }
            };
            if ('IntersectionObserver' in window && !reduceMotion) {
                var observer = new IntersectionObserver(function (entries) {
                    entries.forEach(function (entry) {
                        if (entry.isIntersecting) {
                            startCounter(entry.target);
                            observer.unobserve(entry.target);
                        }
                    });
                }, { threshold: 0.4 });
                nums.forEach(function (el) { observer.observe(el); });
            } else {
                nums.forEach(startCounter);
            }
        }

        /* ---------- 3. 3D tilt (pointer devices only) ---------- */
        var tilts = document.querySelectorAll('[data-tilt]');
        if (tilts.length && window.VanillaTilt && !reduceMotion && !('ontouchstart' in window)) {
            window.VanillaTilt.init(tilts, {
                max: 8,
                speed: 400,
                glare: true,
                'max-glare': 0.15,
                scale: 1.02
            });
        }
    });
})();
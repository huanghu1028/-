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

        /* ---------- 4. hero typewriter (rotating slogans) ---------- */
        var typedEl = document.getElementById('tigerTyped');
        if (typedEl && window.Typewriter && !reduceMotion) {
            typedEl.textContent = '';
            var tw = new window.Typewriter(typedEl, {
                loop: true,
                delay: 80,
                deleteSpeed: 40,
                cursor: '▍'
            });
            tw.typeString('记录每一次训练').pauseFor(1600).deleteAll()
                .typeString('吃对每一餐').pauseFor(1600).deleteAll()
                .typeString('看见每一点进步').pauseFor(1600).deleteAll()
                .typeString('坚持，就是改变').pauseFor(1600).deleteAll()
                .start();
        }

        /* ---------- 5. parallax depth (pointer devices only) ---------- */
        var rellaxEls = document.querySelectorAll('[data-rellax-speed]');
        if (rellaxEls.length && window.Rellax && !reduceMotion && !('ontouchstart' in window)) {
            new window.Rellax('[data-rellax-speed]', {
                center: true,
                round: true,
                vertical: true,
                horizontal: false
            });
        }

        /* ---------- 6. material ripple on buttons ---------- */
        if (window.Waves && !reduceMotion) {
            window.Waves.attach('.btn', 'waves-light');
            window.Waves.init();
        }

        /* ---------- 7. drifting nebula gradient (background) ---------- */
        var nebula = document.getElementById('tigerNebula');
        if (nebula && window.Granim && !reduceMotion) {
            new window.Granim({
                element: '#tigerNebula',
                direction: 'radial',
                isPausedWhenNotInView: true,
                states: {
                    'default-state': {
                        gradients: [
                            ['#2b1600', '#000000'],
                            ['#001c28', '#000000'],
                            ['#241019', '#000000']
                        ],
                        transitionSpeed: 7000,
                        loop: true
                    }
                }
            });
            /* Perf: the gradient is smooth, so paint it at 1/3 resolution and
               let CSS upscale it. Full-res per-frame radial fills cost ~9x more
               and dropped the page from 165fps to ~100fps on a 1.5dpr display.
               Granim resets the canvas on window resize; re-apply after it. */
            var nebulaScale = function () {
                nebula.width = Math.max(2, Math.round(nebula.clientWidth / 3));
                nebula.height = Math.max(2, Math.round(nebula.clientHeight / 3));
            };
            nebulaScale();
            window.addEventListener('resize', nebulaScale);
        }

        /* ---------- 8. floating tiger-orange embers (background) ---------- */
        var embers = document.getElementById('tigerEmbers');
        if (embers && window.particlesJS && !reduceMotion) {
            window.particlesJS('tigerEmbers', {
                particles: {
                    number: { value: 40, density: { enable: true, value_area: 900 } },
                    color: { value: ['#ff9f43', '#ffc46b', '#ffffff'] },
                    shape: { type: 'circle' },
                    opacity: {
                        value: 0.55,
                        random: true,
                        anim: { enable: true, speed: 0.6, opacity_min: 0.18, sync: false }
                    },
                    size: { value: 2.6, random: true },
                    line_linked: { enable: false },
                    move: {
                        enable: true,
                        speed: 0.7,
                        direction: 'none',
                        random: true,
                        straight: false,
                        out_mode: 'out'
                    }
                },
                interactivity: {
                    detect_on: 'window',
                    events: {
                        onhover: { enable: true, mode: 'repulse' },
                        onclick: { enable: false },
                        resize: true
                    },
                    modes: { repulse: { distance: 70, duration: 0.4 } }
                },
                /* Perf: retina_detect multiplies the canvas by devicePixelRatio
                   (2548x1402 at 1.5dpr) for dots a few px wide; CSS resolution
                   is visually identical and ~2.2x cheaper per frame. */
                retina_detect: false
            });
        }
    });
})();
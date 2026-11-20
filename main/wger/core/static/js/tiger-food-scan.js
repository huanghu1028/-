/* tiger-减脂 · 拍照识餐页面交互（无构建步骤，原生 JS）
 * 上传预览 / 拖拽 / 候选切换与份量实时热量计算 */
(function () {
    'use strict';

    var dataEl = document.getElementById('food-candidates-data');
    var candidates = dataEl ? JSON.parse(dataEl.textContent) : [];
    var byKey = {};
    candidates.forEach(function (c) { byKey[c.key] = c; });

    /* ---------- upload preview & drag-drop ---------- */
    var dropzone = document.getElementById('food-dropzone');
    var fileInput = document.getElementById('id_image');
    var preview = document.getElementById('food-preview');
    var hint = document.getElementById('food-dropzone-hint');

    function showPreview(file) {
        if (!file || !file.type || file.type.indexOf('image/') !== 0) { return; }
        if (preview) {
            preview.src = URL.createObjectURL(file);
            preview.classList.remove('d-none');
        }
        if (hint) { hint.classList.add('d-none'); }
    }

    if (fileInput) {
        fileInput.addEventListener('change', function () {
            if (fileInput.files && fileInput.files[0]) { showPreview(fileInput.files[0]); }
        });
    }
    if (dropzone) {
        ['dragenter', 'dragover'].forEach(function (evt) {
            dropzone.addEventListener(evt, function (e) {
                e.preventDefault();
                dropzone.classList.add('is-dragover');
            });
        });
        ['dragleave', 'drop'].forEach(function (evt) {
            dropzone.addEventListener(evt, function (e) {
                e.preventDefault();
                dropzone.classList.remove('is-dragover');
            });
        });
        dropzone.addEventListener('drop', function (e) {
            var files = e.dataTransfer && e.dataTransfer.files;
            if (files && files.length && fileInput) {
                fileInput.files = files;
                showPreview(files[0]);
            }
        });
    }

    var uploadForm = document.getElementById('food-upload-form');
    var uploadBtn = document.getElementById('food-upload-btn');
    if (uploadForm && uploadBtn) {
        uploadForm.addEventListener('submit', function () {
            if (!fileInput || !fileInput.files || !fileInput.files.length) { return; }
            uploadBtn.disabled = true;
            uploadBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>识别中…';
        });
    }

    /* ---------- live calorie calculation ---------- */
    var gramsInput = document.getElementById('portion-grams');
    var kcalEl = document.getElementById('calc-kcal');
    var proteinEl = document.getElementById('calc-protein');
    var fatEl = document.getElementById('calc-fat');
    var carbsEl = document.getElementById('calc-carbs');

    function selectedKey() {
        var checked = document.querySelector('#food-candidates input[name="food_key"]:checked');
        return checked ? checked.value : null;
    }

    function clampGrams(g) {
        return Math.max(1, Math.min(1000, Math.round(g / 5) * 5 || 5));
    }

    function recalc() {
        var food = byKey[selectedKey()];
        if (!food || !gramsInput) { return; }
        var grams = parseFloat(gramsInput.value) || 0;
        var factor = grams / 100;
        if (kcalEl) { kcalEl.textContent = Math.round(food.energy * factor); }
        if (proteinEl) { proteinEl.textContent = (food.protein * factor).toFixed(1); }
        if (fatEl) { fatEl.textContent = (food.fat * factor).toFixed(1); }
        if (carbsEl) { carbsEl.textContent = (food.carbs * factor).toFixed(1); }

        document.querySelectorAll('.food-candidate').forEach(function (label) {
            var radio = label.querySelector('input[name="food_key"]');
            label.classList.toggle('active', radio && radio.checked);
        });
    }

    if (gramsInput) {
        gramsInput.addEventListener('input', recalc);
    }
    document.querySelectorAll('#food-candidates input[name="food_key"]').forEach(function (radio) {
        radio.addEventListener('change', function () {
            var food = byKey[radio.value];
            if (food && gramsInput) { gramsInput.value = food.serving; }
            recalc();
        });
    });
    document.querySelectorAll('.food-portion-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
            var food = byKey[selectedKey()];
            if (food && gramsInput) {
                gramsInput.value = clampGrams(food.serving * parseFloat(btn.dataset.factor));
                recalc();
            }
        });
    });

    if (candidates.length) { recalc(); }
})();
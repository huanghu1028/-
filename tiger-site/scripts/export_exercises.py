# -*- coding: utf-8 -*-
"""把本地 wger 动作库导出为 tiger-site 的静态数据与压缩图片。

用法（任意目录均可）：
    main/.venv/Scripts/python.exe tiger-site/scripts/export_exercises.py

输出（相对 tiger-site/）：
    public/data/exercises.json   979 个动作：中文名/英文名/分类/肌群/器械/说明/图片
    public/data/taxonomy.json    分类、器械、肌群（含中文译名）
    public/data/foods.json       复制自 tiger-site/data/foods.json（常见食物估算营养）
    public/img/ex/{id}-{n}.jpg   压缩后的动作照片（仅导出数据库引用的图片）
    public/img/brand/*           老虎品牌素材

中文名优先级：zh_names.OVERRIDES > 官方 zh 翻译 > zh_names.CURATED > 英文原名。
说明文本：优先官方中文翻译，否则英文原文（前端标注语言）。HTML 转纯文本。
"""
import json
import os
import re
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent      # tiger-site/scripts
SITE = HERE.parent                          # tiger-site
MAIN = SITE.parent / 'main'                 # wger 项目根

sys.path.insert(0, str(MAIN))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'settings.local_dev')

import django  # noqa: E402

django.setup()

from django.conf import settings  # noqa: E402
from django.utils.html import strip_tags  # noqa: E402
from PIL import Image  # noqa: E402

from wger.exercises.models import (  # noqa: E402
    Equipment,
    Exercise,
    ExerciseCategory,
    ExerciseImage,
    Muscle,
    Translation,
)

sys.path.insert(0, str(HERE))
from zh_names import CATEGORY_ZH, CURATED, EQUIPMENT_ZH, MUSCLE_ZH, OVERRIDES  # noqa: E402

MAX_SIDE = 560
JPEG_QUALITY = 72
DESC_LIMIT = 1500


def clean_html(raw: str) -> str:
    text = strip_tags(raw or '')
    text = text.replace('&nbsp;', ' ')
    text = re.sub(r'\s+', ' ', text).strip()
    return text[:DESC_LIMIT]


def compress_image(src: Path, dst: Path) -> bool:
    try:
        with Image.open(src) as im:
            if im.mode in ('RGBA', 'LA', 'P'):
                im = im.convert('RGBA')
                bg = Image.new('RGB', im.size, (255, 255, 255))
                bg.paste(im, mask=im.split()[-1])
                im = bg
            else:
                im = im.convert('RGB')
            im.thumbnail((MAX_SIDE, MAX_SIDE), Image.LANCZOS)
            im.save(dst, 'JPEG', quality=JPEG_QUALITY, optimize=True)
        return True
    except Exception as exc:  # noqa: BLE001
        print(f'  [warn] 图片压缩失败 {src.name}: {exc}')
        return False


def main() -> None:
    media_root = Path(settings.MEDIA_ROOT)
    out_data = SITE / 'public' / 'data'
    out_img = SITE / 'public' / 'img' / 'ex'
    out_brand = SITE / 'public' / 'img' / 'brand'
    for d in (out_data, out_img, out_brand):
        d.mkdir(parents=True, exist_ok=True)

    en_name = dict(Translation.objects.filter(language__short_name='en')
                   .values_list('exercise_id', 'name'))
    zh_name = dict(Translation.objects.filter(language__short_name='zh')
                   .values_list('exercise_id', 'name'))
    en_desc = dict(Translation.objects.filter(language__short_name='en')
                   .values_list('exercise_id', 'description'))
    zh_desc = dict(Translation.objects.filter(language__short_name='zh')
                   .values_list('exercise_id', 'description'))

    # 图片：按动作分组，主图在前；只处理数据库引用的文件
    images_by_ex: dict[int, list[str]] = {}
    img_rows = ExerciseImage.objects.order_by('exercise_id', '-is_main', 'id')
    written = missing = failed = 0
    total_bytes = 0
    counters: dict[int, int] = {}
    for row in img_rows:
        src = media_root / row.image.name
        if not src.exists():
            missing += 1
            continue
        n = counters.get(row.exercise_id, 0) + 1
        counters[row.exercise_id] = n
        rel = f'/img/ex/{row.exercise_id}-{n}.jpg'
        dst = SITE / 'public' / rel.lstrip('/')
        if compress_image(src, dst):
            written += 1
            total_bytes += dst.stat().st_size
            images_by_ex.setdefault(row.exercise_id, []).append(rel)

    exercises = []
    stats = {'override': 0, 'official': 0, 'curated': 0, 'english': 0}
    review = []
    qs = (Exercise.objects.order_by('id')
          .select_related('category')
          .prefetch_related('muscles', 'muscles_secondary', 'equipment'))
    for e in qs:
        en = en_name.get(e.id, '') or f'Exercise {e.id}'
        if e.id in OVERRIDES:
            name, source = OVERRIDES[e.id], 'override'
        elif zh_name.get(e.id):
            name, source = zh_name[e.id], 'official'
        elif e.id in CURATED:
            name, source = CURATED[e.id], 'curated'
        else:
            name, source = en, 'english'
        stats[source] += 1
        review.append(f'{e.id}\t{en}\t{name}\t{source}')

        desc_zh = clean_html(zh_desc.get(e.id, ''))
        desc_en = clean_html(en_desc.get(e.id, ''))
        if desc_zh:
            desc, desc_lang = desc_zh, 'zh'
        elif desc_en:
            desc, desc_lang = desc_en, 'en'
        else:
            desc, desc_lang = '', ''

        exercises.append({
            'id': e.id,
            'name': name,
            'name_en': en,
            'category': e.category_id,
            'muscles': [m.id for m in e.muscles.all()],
            'muscles_secondary': [m.id for m in e.muscles_secondary.all()],
            'equipment': [q.id for q in e.equipment.all()],
            'description': desc,
            'description_lang': desc_lang,
            'images': images_by_ex.get(e.id, []),
        })

    taxonomy = {
        'categories': [
            {'id': c.id, 'name': CATEGORY_ZH.get(c.name, c.name), 'name_en': c.name}
            for c in ExerciseCategory.objects.order_by('id')
        ],
        'equipment': [
            {'id': q.id, 'name': EQUIPMENT_ZH.get(q.name, q.name), 'name_en': q.name}
            for q in Equipment.objects.order_by('id')
        ],
        'muscles': [
            {'id': m.id, 'name': MUSCLE_ZH.get(m.name, m.name),
             'name_en': m.name, 'is_front': m.is_front}
            for m in Muscle.objects.order_by('id')
        ],
    }

    (out_data / 'exercises.json').write_text(
        json.dumps(exercises, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    (out_data / 'taxonomy.json').write_text(
        json.dumps(taxonomy, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')

    foods_src = SITE / 'data' / 'foods.json'
    if foods_src.exists():
        shutil.copyfile(foods_src, out_data / 'foods.json')
    else:
        print('[warn] 缺少 tiger-site/data/foods.json，未导出食物数据')

    brand_src = MAIN / 'wger' / 'core' / 'static' / 'images' / 'tiger'
    for f in brand_src.iterdir():
        if f.is_file():
            shutil.copyfile(f, out_brand / f.name)

    review_path = Path.home() / 'tools' / 'ex_review.tsv'
    review_path.write_text('\n'.join(review), encoding='utf-8')

    ex_size = (out_data / 'exercises.json').stat().st_size
    with_images = sum(1 for e in exercises if e['images'])
    print(f'动作总数: {len(exercises)}')
    print(f'中文名来源: 官方 {stats["official"]} / 人工 {stats["curated"]} / '
          f'修正 {stats["override"]} / 英文回退 {stats["english"]}')
    print(f'有图动作: {with_images}；图片导出 {written} 张（缺失 {missing}，失败 {failed}），'
          f'共 {total_bytes / 1024 / 1024:.1f} MB')
    print(f'exercises.json: {ex_size / 1024 / 1024:.2f} MB')
    print(f'分类 {len(taxonomy["categories"])} / 器械 {len(taxonomy["equipment"])} / '
          f'肌群 {len(taxonomy["muscles"])}')
    print(f'译名抽查表: {review_path}')


if __name__ == '__main__':
    main()
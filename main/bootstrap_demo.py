#!/usr/bin/env python
"""tiger-减脂 一键演示环境还原脚本。

fresh clone 后仓库里没有动作图片与演示数据（media/ 与数据库均被 gitignore），
本脚本按幂等方式补齐：

    .venv/Scripts/python bootstrap_demo.py      # Windows
    .venv/bin/python bootstrap_demo.py          # Linux / macOS

步骤：migrate -> 同步动作数据 -> 官方动作图片 -> free-exercise-db 补图 ->
演示账号 admin/wger2026（界面通知语言 zh-hans）。
已有数据默认跳过；--force 重新同步，--skip-images 跳过图片步骤。
"""

# Standard Library
import argparse
import os
import pathlib
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'settings.local_dev')
sys.path.insert(0, str(ROOT))

# Django
import django  # noqa: E402

django.setup()

from django.contrib.auth.models import User  # noqa: E402

# wger
from wger.core.models import Language  # noqa: E402
from wger.exercises.models import Exercise  # noqa: E402

MANAGE = [sys.executable, str(ROOT / 'manage.py')]
SETTINGS_FLAG = '--settings=settings.local_dev'


def run(*args):
    print('+', ' '.join(str(a) for a in args), flush=True)
    subprocess.run(MANAGE + [str(a) for a in args] + [SETTINGS_FLAG],
                   cwd=ROOT, check=True)


def main():
    parser = argparse.ArgumentParser(description='还原 tiger-减脂 演示环境（幂等）')
    parser.add_argument('--force', action='store_true', help='已有数据也重新同步')
    parser.add_argument('--skip-images', action='store_true', help='跳过图片下载与补图')
    parser.add_argument('--dataset-path', help='yuhonas/free-exercise-db 的本地克隆路径')
    args = parser.parse_args()

    run('migrate', '--noinput')

    have = Exercise.objects.count()
    if have and not args.force:
        print(f'= 已有动作数据（{have} 条），跳过同步；--force 可重跑')
    else:
        run('sync-exercises')

    if args.skip_images:
        print('= 跳过图片（--skip-images）')
    elif have and not args.force:
        print('= 已有数据视为含图片，跳过图片步骤；--force 可重跑')
    else:
        run('download-exercise-images')
        dataset = args.dataset_path
        if not dataset:
            dataset = pathlib.Path(tempfile.gettempdir()) / 'free-exercise-db'
            if not (pathlib.Path(dataset) / 'exercises.json').exists():
                print('+ 克隆 free-exercise-db（公共领域数据集）...', flush=True)
                subprocess.run(
                    ['git', 'clone', '--depth', '1',
                     'git@github.com:yuhonas/free-exercise-db.git', str(dataset)],
                    check=True)
        run('import-free-exercise-images', '--dataset-path', dataset)

    user, created = User.objects.get_or_create(
        username='admin', defaults={'is_staff': True, 'is_superuser': True})
    if created or args.force:
        user.set_password('wger2026')
        user.is_staff = True
        user.is_superuser = True
        user.save()
    zh = Language.objects.filter(short_name='zh-hans').first()
    if zh and hasattr(user, 'userprofile'):
        user.userprofile.notification_language = zh
        user.userprofile.save()
    print('= 演示账号就绪：admin / wger2026' + ('（新建）' if created else '（已存在）'))

    print('\n完成。启动网站：')
    print('  ' + ' '.join(MANAGE) + ' runserver 127.0.0.1:8000 ' + SETTINGS_FLAG)
    print('  打开 http://127.0.0.1:8000/zh-hans/')


if __name__ == '__main__':
    main()
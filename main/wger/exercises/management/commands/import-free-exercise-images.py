# This file is part of wger Workout Manager.
#
# wger Workout Manager is free software: you can redistribute it and/or modify
# it under the terms of the GNU Affero General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
#
# wger Workout Manager is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU Affero General Public License for more details.
#
# You should have received a copy of the GNU Affero General Public License
# along with Workout Manager. If not, see <http://www.gnu.org/licenses/>.

"""
Import exercise illustrations from the free-exercise-db dataset (GitHub).

Source: https://github.com/yuhonas/free-exercise-db (Unlicense / public domain,
upstream data from https://github.com/wrkout/exercises.json). Clone the repo and
pass its root with --dataset-path. Only exercises that have no image at all are
filled, so official wger images synced with ``download-exercise-images`` always
take precedence. Exercises are matched by name over all local translations.
"""

# Standard Library
import json
import pathlib
import re

# Django
from django.core.files import File
from django.core.management.base import BaseCommand, CommandError

# wger
from wger.exercises.models import Exercise, ExerciseImage, Translation

# Dataset name -> local exercise name, for entries whose wording differs.
# Curated synonyms: same movement, different name in the two databases.
ALIASES = {
    'Ab Crunch Machine': 'Crunches on Machine',
    'Air Bike': 'bicycle crunches',
    'Barbell Lunge': 'Barbell Lunges Standing',
    'Battling Ropes': 'Battle Ropes',
    'Bench Dips': 'Bench Dips On Floor HD',
    'Bench Press - Powerlifting': 'Pause Bench',
    'Bent-Knee Hip Raise': 'Hip Raise, Lying',
    'Bodyweight Squat': 'Bodyweight Squat HD',
    'Bodyweight Walking Lunge': 'Bodyweight lunge HD',
    'Concentration Curls': 'Dumbbell Concentration Curl',
    'Cross-Body Crunch': 'bicycle crunches',
    'Crunch - Legs On Exercise Ball': 'Crunches With Legs Up',
    'Crunches': 'Abdominal Crunch',
    'Decline Crunch': 'Roman Chair Crunch',
    'Dumbbell Bicep Curl': 'Dumbbell Curl',
    'Dumbbell Lunges': 'Dumbbell Lunges Standing',
    'Dumbbell Rear Lunge': 'Alternate back lunges',
    'Dumbbell Seated One-Leg Calf Raise': 'Calf raises, one legged',
    'Jackknife Sit-Up': 'V-Up',
    'Kettlebell One-Legged Deadlift': 'Single Leg RDL',
    'Kettlebell Turkish Get-Up (Squat style)': 'Turkish Get-Up',
    'Machine Triceps Extension': 'Triceps on Machine',
    'Natural Glute Ham Raise': 'Nordic Curl',
    'One-Arm Kettlebell Swings': 'Kettlebell Swings',
    'Palms-Down Wrist Curl Over A Bench': 'Barbell Reverse Wrist Curl',
    'Palms-Up Barbell Wrist Curl Over A Bench': 'Barbell Wrist Curl',
    'Pin Presses': 'Pin Bench Press BB',
    'Plie Dumbbell Squat': 'Sumo Squats',
    'Push-Up Wide': 'Wide Push-Up',
    'Push-Ups - Close Triceps Position': 'Diamond push ups',
    'Reverse Barbell Curl': 'Reverse Bar Curl',
    'Reverse Cable Curl': 'Reverse EZ Bar Cable Curls',
    'Romanian Deadlift': 'Barbell Romanian Deadlift (RDL)',
    'Rope Jumping': 'Jump rope: basic jumps',
    'Rowing, Stationary': 'Rowing Machine',
    'Seated Calf Raise': 'Sitting Calf Raises',
    'Side Bridge': 'Side Plank',
    'Smith Machine Behind the Back Shrug': 'Shrugs on Multipress',
    'Smith Machine Overhead Shoulder Press': 'Shoulder Press, on Multi Press',
    'Smith Machine Squat': 'Squats on Multipress',
    'Standing Biceps Cable Curl': 'Cable Curls',
    'Standing Cable Wood Chop': 'Cable Woodchoppers',
    'Standing Dumbbell Reverse Curl': 'Reverse Curl',
    'Star Jump': 'Jumping Jack HD',
    'Stiff-Legged Dumbbell Deadlift': 'Dumbbell Deadlift',
    'Triceps Pushdown - V-Bar Attachment': 'Triceps Extensions on Cable With Bar',
    'V-Bar Pullup': 'Pull-Ups (Neutral Grip)',
    'Weighted Bench Dip': 'Chair dips',
    'Wide-Grip Rear Pull-Up': 'Pull-Ups (Wide Grip)',
}

# Words that describe equipment, posture or execution details instead of the
# movement itself. Two names match when their remaining "core" words agree
# (equal or subset) and neither equipment nor posture contradicts.
EQUIPMENT_WORDS = {
    'barbell', 'dumbbell', 'kettlebell', 'cable', 'machine', 'smith', 'band',
    'ez', 'bar', 'rope', 'trx', 'ring', 'ball', 'bosu', 'box', 'board',
    'fingerboard', 'hex', 'trap', 'v', 'handle', 'strap', 'belt', 'wheel',
    'roller', 'sled', 'platform', 'wall',
}
POSTURE_WORDS = {
    'seated', 'standing', 'lying', 'kneeling', 'incline', 'decline', 'flat',
    'prone', 'supine', 'hanging', 'supported',
}
MODIFIER_WORDS = {
    'medium', 'wide', 'close', 'narrow', 'grip', 'one', 'arm', 'single',
    'double', 'alternate', 'alternating', 'reverse', 'reversed',
    'side', 'underhand', 'overhand', 'neutral', 'parallel', 'full', 'half',
    'partial', 'heavy', 'light', 'slow', 'fast', 'isometric', 'weighted',
    'assisted', 'basic', 'advanced', 'beginner', 'intermediate', 'exercise',
    'exercises', 'the', 'a', 'an', 'with', 'on', 'in', 'at', 'to', 'of',
    'for', 'and', 'or', 'vs', 'position', 'static', 'dynamic', 'classic',
    'traditional', 'normal', 'regular', 'standard', 'simple', 'modified',
    'variation', 'version', 'style', 'width', 'stance', 'three', 'using',
    'w', 'off', 'against',
}
NUMBER_WORDS = {'one', 'two', 'double', 'single', 'alternate'}
# Muscle words that one database may omit without changing the movement
# ("Barbell Curl" vs "Biceps Curls With Barbell"). Kept deliberately small.
EXTRA_OK_WORDS = {
    'bicep', 'shoulder', 'delt', 'lat', 'adductor', 'abductor',
    'rotator', 'cuff', 'trapezius',
}

# The dataset ships real gym photos of the start / end position.
IMAGE_STYLE = ExerciseImage.PHOTO

LICENSE_ID = 3  # CC0 / public domain
LICENSE_TITLE = 'Creative Commons Public Domain 1.0'
LICENSE_URL = 'http://creativecommons.org/publicdomain/zero/1.0/'
LICENSE_AUTHOR = 'wrkout/exercises.json & yuhonas/free-exercise-db (public domain)'
LICENSE_AUTHOR_URL = 'https://github.com/yuhonas/free-exercise-db'
LICENSE_SOURCE_URL = 'https://github.com/wrkout/exercises.json'


def normalize(name):
    """Lowercase and reduce a name to alphanumeric words for matching"""
    return re.sub(r'[^a-z0-9]+', ' ', name.casefold()).strip()


def tokens(name):
    """Normalized word list with a crude singular form"""
    compounds = {'pullup': 'pull up', 'pushup': 'push up', 'chinup': 'chin up', 'situp': 'sit up'}
    out = []
    for token in normalize(name).split():
        if token.endswith(('ches', 'shes', 'sses', 'xes', 'zes')):
            token = token[:-2]
        elif len(token) > 2 and token.endswith('s') and not token.endswith(('ss', 'us', 'is')):
            token = token[:-1]
        if token == 'alternating':
            token = 'alternate'
        out.extend(compounds.get(token, token).split())
    return out


def name_key(name):
    """Exact-match key: singularized words"""
    return ' '.join(tokens(name))


def split_name(name):
    """Return (core, equipment, posture, numbers) word sets of a name"""
    words = set(tokens(name))
    core = words - EQUIPMENT_WORDS - POSTURE_WORDS - MODIFIER_WORDS - NUMBER_WORDS
    return core, words & EQUIPMENT_WORDS, words & POSTURE_WORDS, words & NUMBER_WORDS


class Command(BaseCommand):
    """
    Fill image-less exercises with the free-exercise-db illustrations
    """

    help = (
        'Import exercise illustrations from a local clone of '
        'https://github.com/yuhonas/free-exercise-db for exercises that '
        'have no image yet. Match is done by exercise name.'
    )

    def add_arguments(self, parser):
        parser.add_argument(
            '--dataset-path',
            required=True,
            help='Root directory of a free-exercise-db clone',
        )
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Only report what would be imported',
        )
        parser.add_argument(
            '--limit',
            type=int,
            default=0,
            help='Stop after importing this many exercises (0 = no limit)',
        )

    def handle(self, **options):
        root = pathlib.Path(options['dataset_path'])
        data_file = root / 'dist' / 'exercises.json'
        if not data_file.is_file():
            raise CommandError(f'{data_file} not found, clone free-exercise-db first')

        entries = json.loads(data_file.read_text(encoding='utf-8'))

        # Any translation name may match, the dataset is English-only but local
        # exercises carry English names as well.
        index = {}
        for name, exercise_id in Translation.objects.values_list('name', 'exercise_id'):
            index.setdefault(name_key(name), exercise_id)

        # Fuzzy fallback compares English names only
        en_names = dict(
            Translation.objects.filter(language__short_name='en').values_list('exercise_id', 'name')
        )
        local_fuzzy = []
        for exercise_id, name in en_names.items():
            core, equipment, posture, numbers = split_name(name)
            if core:
                modifiers = len(set(tokens(name)) & (MODIFIER_WORDS | NUMBER_WORDS))
                local_fuzzy.append(
                    (exercise_id, name, core, equipment, posture, numbers, modifiers)
                )

        def fuzzy_match(name):
            core, equipment, posture, numbers = split_name(name)
            if not core:
                return None
            best = None
            for exercise_id, local_name, lcore, lequipment, lposture, lnumbers, lmods in local_fuzzy:
                extra = core ^ lcore
                if core == lcore:
                    tier = 0 if len(core) >= 2 else 2
                elif (core < lcore or lcore < core) and extra <= EXTRA_OK_WORDS:
                    tier = 1
                else:
                    continue
                if 'stretch' in core or 'stretch' in lcore:
                    if core != lcore:
                        continue
                if equipment and lequipment and equipment.isdisjoint(lequipment):
                    continue
                if posture != lposture:
                    continue
                if numbers and lnumbers and numbers != lnumbers:
                    continue
                score = (
                    tier,
                    len(extra),
                    len(numbers ^ lnumbers),
                    len(equipment ^ lequipment),
                    lmods,
                )
                if best is None or score < best[0]:
                    best = (score, exercise_id, local_name)
            return best

        with_images = set(ExerciseImage.objects.values_list('exercise_id', flat=True))

        matched = skipped = imported_exercises = imported_images = 0
        misses = []
        fuzzy_pairs = []
        for entry in entries:
            name = entry['name']
            exercise_id = index.get(name_key(ALIASES.get(name, name)))
            if exercise_id is None:
                best = fuzzy_match(name)
                if best is None:
                    misses.append(name)
                    continue
                _, exercise_id, local_name = best
                fuzzy_pairs.append(f'{name} -> {local_name}')
            matched += 1
            if exercise_id in with_images:
                skipped += 1
                continue
            if options['limit'] and imported_exercises >= options['limit']:
                break

            exercise = Exercise.objects.get(pk=exercise_id)
            files = [root / 'exercises' / rel for rel in entry.get('images', [])[:2]]
            files = [f for f in files if f.is_file()]
            if not files:
                misses.append(f'{name} (no image files)')
                continue

            if options['dry_run']:
                self.stdout.write(
                    f'would import {len(files)} image(s) for {name} -> {en_names.get(exercise_id)}'
                )
                imported_images += len(files)
            else:
                for i, src in enumerate(files):
                    image = ExerciseImage(
                        exercise=exercise,
                        is_main=(i == 0),
                        style=IMAGE_STYLE,
                        license_id=LICENSE_ID,
                        license_title=LICENSE_TITLE,
                        license_object_url=LICENSE_URL,
                        license_author=LICENSE_AUTHOR,
                        license_author_url=LICENSE_AUTHOR_URL,
                        license_derivative_source_url=LICENSE_SOURCE_URL,
                    )
                    with src.open('rb') as fh:
                        image.image.save(f'free-exercise-db-{entry["id"]}-{i}{src.suffix}', File(fh), save=False)
                    if not image.width or not image.height:
                        # Dimension fields are only refreshed on committed saves
                        from PIL import Image as PILImage

                        with PILImage.open(src) as im:
                            image.width, image.height = im.size
                    image.save()
                    imported_images += 1
            imported_exercises += 1
            with_images.add(exercise_id)

        self.stdout.write(
            self.style.SUCCESS(
                f'matched {matched} dataset entries, {skipped} already had images, '
                f'{"would import" if options["dry_run"] else "imported"} '
                f'{imported_images} image(s) for {imported_exercises} exercise(s)'
            )
        )
        self.stdout.write(f'{len(misses)} dataset entries did not match, first 40:')
        for name in misses[:40]:
            self.stdout.write(f'  - {name}')
        self.stdout.write(f'{len(fuzzy_pairs)} fuzzy matches:')
        for pair in fuzzy_pairs:
            self.stdout.write(f'  ~ {pair}')
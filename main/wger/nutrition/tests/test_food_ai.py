#  This file is part of wger Workout Manager <https://github.com/wger-project>.
#  Copyright (C) 2013 - 2021 wger Team
#
#  wger Workout Manager is free software: you can redistribute it and/or modify
#  it under the terms of the GNU Affero General Public License as published by
#  the Free Software Foundation, either version 3 of the License, or
#  (at your option) any later version.
#
#  wger Workout Manager is distributed in the hope that it will be useful,
#  but WITHOUT ANY WARRANTY; without even the implied warranty of
#  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
#  GNU Affero General Public License for more details.
#
#  You should have received a copy of the GNU Affero General Public License
#  along with this program.  If not, see <http://www.gnu.org/licenses/>.

"""
Tests for the food photo scan feature: reference data, advice engine,
ONNX recognizer and the scan/log views.
"""

# Standard Library
import datetime
import io
import tempfile

# Django
from django.contrib.auth.models import User
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import (
    TestCase,
    override_settings,
)
from django.urls import reverse
from django.utils import timezone

# Third Party
from PIL import Image

# wger
from wger.core.tests.base_testcase import WgerTestCase
from wger.nutrition.food_ai import (
    advice,
    recognizer,
)
from wger.nutrition.food_ai.food_data import (
    FOOD101_KEYS,
    FOODS,
)
from wger.nutrition.models import (
    FoodPhoto,
    Ingredient,
    LogItem,
    NutritionPlan,
)


def make_png(size=(64, 64), color=(200, 120, 60)) -> bytes:
    buf = io.BytesIO()
    Image.new('RGB', size, color).save(buf, format='PNG')
    return buf.getvalue()


class FoodDataTest(TestCase):
    """The reference table covers the model's 101 classes with sane values"""

    def test_coverage_and_order(self):
        self.assertEqual(len(FOODS), 101)
        self.assertEqual(FOOD101_KEYS, sorted(FOODS))

    def test_values_are_sane(self):
        for food in FOODS.values():
            self.assertGreater(food.energy, 0, food.key)
            self.assertLessEqual(food.energy, 900, food.key)
            for value in (food.protein, food.fat, food.carbs):
                self.assertGreaterEqual(value, 0, food.key)
                self.assertLessEqual(value, 100, food.key)
            self.assertGreater(food.serving, 0, food.key)
            self.assertGreaterEqual(len(food.display_name), 3, food.key)

    def test_kcal_for(self):
        pizza = FOODS['pizza']
        self.assertEqual(pizza.kcal_for(200), pizza.energy * 2)


class AdviceTest(TestCase):
    """The next-meal advice reacts to goal, intake and logged meals"""

    def test_slot_for_log_hour(self):
        self.assertEqual(advice.slot_for_log_hour(8), 'breakfast')
        self.assertEqual(advice.slot_for_log_hour(12.5), 'lunch')
        self.assertEqual(advice.slot_for_log_hour(19), 'dinner')
        self.assertIsNone(advice.slot_for_log_hour(23))

    def test_next_meal_slot(self):
        self.assertEqual(advice.next_meal_slot(8, set()).key, 'breakfast')
        self.assertEqual(advice.next_meal_slot(8, {'breakfast'}).key, 'lunch')
        self.assertEqual(advice.next_meal_slot(13, {'breakfast', 'lunch'}).key, 'dinner')
        self.assertIsNone(advice.next_meal_slot(22, {'breakfast', 'lunch', 'dinner'}))

    def test_on_track(self):
        result = advice.build_advice(
            now_hour=12.5, goal=2500, consumed=800, logged_slots={'breakfast'}
        )
        self.assertEqual(result['status'], 'on_track')
        self.assertEqual(result['slot_key'], 'lunch')
        self.assertEqual(result['meal_budget'], 1000)
        self.assertEqual(result['remaining'], 1700)
        self.assertTrue(result['suggestions'])
        for suggestion in result['suggestions']:
            self.assertIn(suggestion['key'], FOODS)
            self.assertGreater(suggestion['grams'], 0)

    def test_tight_budget(self):
        result = advice.build_advice(
            now_hour=12.5, goal=2500, consumed=2300, logged_slots={'breakfast'}
        )
        self.assertEqual(result['status'], 'tight')
        self.assertEqual(result['meal_budget'], 200)

    def test_over_goal(self):
        result = advice.build_advice(
            now_hour=12.5, goal=2500, consumed=2700, logged_slots={'breakfast'}
        )
        self.assertEqual(result['status'], 'over')
        self.assertEqual(result['remaining'], -200)
        self.assertLessEqual(len(result['suggestions']), 1)

    def test_closed_day(self):
        result = advice.build_advice(
            now_hour=22, goal=2500, consumed=2400, logged_slots={'breakfast', 'lunch', 'dinner'}
        )
        self.assertEqual(result['status'], 'closed')
        self.assertIsNone(result['slot_key'])

    def test_protein_hint(self):
        result = advice.build_advice(
            now_hour=12.5,
            goal=2500,
            consumed=800,
            protein_consumed=5,
            logged_slots={'breakfast'},
            protein_goal=150,
        )
        self.assertIsNotNone(result['protein_hint'])


class RecognizerTest(TestCase):
    """The vendored ONNX model runs locally and returns valid predictions"""

    def test_predictions(self):
        image = Image.open(io.BytesIO(make_png()))
        preds = recognizer.recognize(image)
        self.assertEqual(len(preds), 5)
        for pred in preds:
            self.assertIn(pred['key'], FOODS)
            self.assertGreaterEqual(pred['prob'], 0)
            self.assertLessEqual(pred['prob'], 1)
        self.assertLessEqual(sum(p['prob'] for p in preds), 1.0001)
        self.assertEqual(preds, sorted(preds, key=lambda p: -p['prob']))

    def test_deterministic(self):
        image = Image.open(io.BytesIO(make_png()))
        self.assertEqual(
            recognizer.recognize(image)[0]['key'], recognizer.recognize(image)[0]['key']
        )


@override_settings(MEDIA_ROOT=tempfile.mkdtemp())
class FoodPhotoViewTest(WgerTestCase):
    """Scan page access, upload recognition and diary logging"""

    def setUp(self):
        super().setUp()
        self.scan_url = reverse('nutrition:food_ai:scan')
        self.log_url = reverse('nutrition:food_ai:log')

    def make_photo(self, user) -> FoodPhoto:
        return FoodPhoto.objects.create(
            user=user,
            image=SimpleUploadedFile('food.png', make_png(), content_type='image/png'),
            label='pizza',
            confidence=0.9,
            predictions=[{'key': 'pizza', 'prob': 0.9}],
        )

    def test_anonymous_redirect(self):
        response = self.client.get(self.scan_url)
        self.assertEqual(response.status_code, 302)

    def test_scan_page(self):
        self.user_login('admin')
        response = self.client.get(self.scan_url)
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, '拍照识餐')
        self.assertContains(response, '下一餐建议')

    def test_upload_recognizes(self):
        self.user_login('admin')
        user = User.objects.get(username='admin')
        count = FoodPhoto.objects.filter(user=user).count()
        response = self.client.post(
            self.scan_url,
            {'image': SimpleUploadedFile('food.png', make_png(), content_type='image/png')},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(FoodPhoto.objects.filter(user=user).count(), count + 1)
        photo = FoodPhoto.objects.filter(user=user).first()
        self.assertIn(photo.label, FOODS)
        self.assertEqual(len(photo.predictions), 5)
        self.assertContains(response, '确认食物与份量')

    def test_log_creates_diary_entry(self):
        self.user_login('admin')
        user = User.objects.get(username='admin')
        photo = self.make_photo(user)
        logs_before = LogItem.objects.filter(plan__user=user).count()

        response = self.client.post(
            self.log_url, {'photo_id': photo.pk, 'food_key': 'pizza', 'grams': 200}
        )
        self.assertEqual(response.status_code, 302)
        self.assertEqual(LogItem.objects.filter(plan__user=user).count(), logs_before + 1)

        photo.refresh_from_db()
        entry = photo.log_item
        self.assertIsNotNone(entry)
        self.assertEqual(entry.amount, 200)
        self.assertEqual(entry.ingredient.energy, FOODS['pizza'].energy)
        values = entry.get_nutritional_values()
        self.assertEqual(round(float(values.energy)), FOODS['pizza'].kcal_for(200))

    def test_log_creates_plan_for_new_user(self):
        User.objects.create_user('scanuser', password='scanuser12345')
        self.client.login(username='scanuser', password='scanuser12345')
        user = User.objects.get(username='scanuser')
        self.assertFalse(NutritionPlan.objects.filter(user=user).exists())
        photo = self.make_photo(user)

        self.client.post(self.log_url, {'photo_id': photo.pk, 'food_key': 'sushi', 'grams': 250})
        plan = NutritionPlan.objects.get(user=user)
        self.assertTrue(plan.only_logging)
        self.assertEqual(plan.goal_energy, user.userprofile.calories)
        self.assertEqual(LogItem.objects.filter(plan=plan).count(), 1)

    def test_log_reuses_ingredient(self):
        self.user_login('admin')
        user = User.objects.get(username='admin')
        photo = self.make_photo(user)
        self.client.post(self.log_url, {'photo_id': photo.pk, 'food_key': 'pizza', 'grams': 200})
        self.client.post(self.log_url, {'photo_id': photo.pk, 'food_key': 'pizza', 'grams': 100})
        self.assertEqual(Ingredient.objects.filter(name=FOODS['pizza'].display_name).count(), 1)

    def test_log_invalid_grams(self):
        self.user_login('admin')
        user = User.objects.get(username='admin')
        photo = self.make_photo(user)
        logs_before = LogItem.objects.filter(plan__user=user).count()
        for grams in ('0', '1001', 'abc', ''):
            self.client.post(
                self.log_url, {'photo_id': photo.pk, 'food_key': 'pizza', 'grams': grams}
            )
        self.assertEqual(LogItem.objects.filter(plan__user=user).count(), logs_before)

    def test_log_other_users_photo(self):
        self.user_login('admin')
        other = User.objects.get(username='test')
        photo = self.make_photo(other)
        response = self.client.post(
            self.log_url, {'photo_id': photo.pk, 'food_key': 'pizza', 'grams': 200}
        )
        self.assertEqual(response.status_code, 404)

    def test_today_totals_feed_advice(self):
        self.user_login('admin')
        user = User.objects.get(username='admin')
        photo = self.make_photo(user)
        self.client.post(self.log_url, {'photo_id': photo.pk, 'food_key': 'pizza', 'grams': 200})

        plan = NutritionPlan.objects.filter(user=user).order_by('-start', '-id').first()
        photo.refresh_from_db()
        entry = photo.log_item
        entry.datetime = timezone.now()
        entry.save()
        self.assertIn(entry, plan.get_log_entries(datetime.date.today()))

        response = self.client.get(self.scan_url)
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, '今日摄入')

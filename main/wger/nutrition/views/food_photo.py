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
Views for the food photo scan feature: upload a photo, recognize the dish
with the local Food-101 model, log it to the nutrition diary and get
next-meal advice based on the daily calorie goal.
"""

# Standard Library
import logging
from decimal import Decimal

# Django
from django import forms
from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.shortcuts import (
    get_object_or_404,
    redirect,
    render,
)
from django.urls import reverse
from django.utils import timezone
from django.views.decorators.http import require_POST

# Third Party
from PIL import Image

# wger
from wger.core.models import Language
from wger.nutrition.food_ai import (
    advice,
    recognizer,
)
from wger.nutrition.food_ai.food_data import FOODS
from wger.nutrition.helpers import NutritionalValues
from wger.nutrition.models import (
    FoodPhoto,
    Ingredient,
    LogItem,
    NutritionPlan,
)
from wger.utils.images import validate_image_static_no_animation


logger = logging.getLogger(__name__)

MAX_GRAMS = 1000
"""LogItem.amount is validated to 1-1000, grams are logged without a unit"""


class FoodPhotoForm(forms.Form):
    image = forms.ImageField(
        label='食物照片',
        validators=[validate_image_static_no_animation],
        help_text='支持 JPG / PNG，建议拍摄整份食物',
    )


def get_active_plan(user) -> NutritionPlan | None:
    """The plan the dashboard and diary work with: the most recent one"""
    return NutritionPlan.objects.filter(user=user).order_by('-start', '-id').first()


def ensure_plan(user) -> NutritionPlan:
    """Return the active plan, creating a logging-only plan on first use"""
    plan = get_active_plan(user)
    if plan is None:
        plan = NutritionPlan.objects.create(
            user=user,
            only_logging=True,
            description='拍照识餐记录',
            goal_energy=user.userprofile.calories,
            has_goal_calories=True,
        )
    return plan


def get_goal(user, plan: NutritionPlan | None) -> int:
    if plan and plan.goal_energy:
        return plan.goal_energy
    return user.userprofile.calories


def today_totals(plan: NutritionPlan | None, local_date) -> tuple[NutritionalValues, set[str]]:
    """Sum today's diary entries and collect the meal slots already logged"""
    totals = NutritionalValues()
    slots: set[str] = set()
    if plan is None:
        return totals, slots
    for entry in plan.get_log_entries(local_date):
        totals += entry.get_nutritional_values()
        local_dt = timezone.localtime(entry.datetime)
        slot = advice.slot_for_log_hour(local_dt.hour + local_dt.minute / 60)
        if slot:
            slots.add(slot)
    return totals, slots


def build_page_context(request, form=None, result=None) -> dict:
    user = request.user
    profile = user.userprofile
    now = timezone.localtime(timezone.now(), profile.zone_info)
    plan = get_active_plan(user)
    totals, logged_slots = today_totals(plan, now.date())
    goal = get_goal(user, plan)
    protein_goal = plan.goal_protein if plan else None

    advice_data = advice.build_advice(
        now_hour=now.hour + now.minute / 60,
        goal=goal,
        consumed=float(totals.energy),
        protein_consumed=float(totals.protein),
        logged_slots=logged_slots,
        protein_goal=protein_goal,
    )
    percent = min(100, round(float(totals.energy) / goal * 100)) if goal else 0

    recent_photos = []
    for photo in FoodPhoto.objects.filter(user=user).select_related('log_item')[:8]:
        food = FOODS.get(photo.label)
        recent_photos.append(
            {
                'photo': photo,
                'food': food,
                'serving_kcal': food.kcal_for(food.serving) if food else 0,
            }
        )

    return {
        'form': form or FoodPhotoForm(),
        'result': result,
        'plan': plan,
        'goal': goal,
        'consumed': round(float(totals.energy)),
        'remaining': round(goal - float(totals.energy)),
        'percent': percent,
        'protein': round(float(totals.protein), 1),
        'carbohydrates': round(float(totals.carbohydrates), 1),
        'fat': round(float(totals.fat), 1),
        'advice': advice_data,
        'recent_photos': recent_photos,
        'diary_url': reverse('nutrition:plan:diary', kwargs={'id': plan.id}) if plan else None,
        'now': now,
    }


@login_required
def scan(request):
    """Upload page and photo recognition"""
    if request.method == 'POST':
        form = FoodPhotoForm(request.POST, request.FILES)
        if form.is_valid():
            uploaded = form.cleaned_data['image']
            try:
                with Image.open(uploaded) as img:
                    predictions = recognizer.recognize(img)
            except recognizer.RecognizerError:
                logger.exception('Food recognition failed')
                messages.error(request, '识别服务暂时不可用，请稍后重试。')
                return render(request, 'food_photo/scan.html', build_page_context(request))
            except Exception:
                logger.exception('Could not read uploaded food photo')
                messages.error(request, '无法读取这张图片，请换一张 JPG / PNG 照片。')
                return render(request, 'food_photo/scan.html', build_page_context(request))

            photo = FoodPhoto.objects.create(
                user=request.user,
                image=uploaded,
                label=predictions[0]['key'],
                confidence=predictions[0]['prob'],
                predictions=predictions,
            )
            candidates = []
            for pred in predictions:
                food = FOODS[pred['key']]
                candidates.append(
                    {
                        'key': food.key,
                        'zh': food.zh,
                        'en': food.en,
                        'prob': round(pred['prob'] * 100, 1),
                        'energy': food.energy,
                        'protein': food.protein,
                        'fat': food.fat,
                        'carbs': food.carbs,
                        'serving': food.serving,
                    }
                )
            result = {
                'photo': photo,
                'candidates': candidates,
                'default_key': predictions[0]['key'],
                'default_grams': FOODS[predictions[0]['key']].serving,
            }
            return render(
                request, 'food_photo/scan.html', build_page_context(request, result=result)
            )
    else:
        form = FoodPhotoForm()

    return render(request, 'food_photo/scan.html', build_page_context(request, form=form))


@login_required
@require_POST
def log(request):
    """Confirm a recognition result and write it to the nutrition diary"""
    photo = get_object_or_404(FoodPhoto, pk=request.POST.get('photo_id'), user=request.user)
    food = FOODS.get(request.POST.get('food_key', ''))
    if food is None:
        messages.error(request, '请选择一个有效的食物。')
        return redirect('nutrition:food_ai:scan')

    try:
        grams = int(request.POST.get('grams', ''))
    except ValueError:
        grams = 0
    if not 1 <= grams <= MAX_GRAMS:
        messages.error(request, f'份量需在 1-{MAX_GRAMS} 克之间。')
        return redirect('nutrition:food_ai:scan')

    language = Language.objects.filter(short_name='zh').first()
    if language is None:
        language = Language.objects.get(short_name='en')
    ingredient, _created = Ingredient.objects.get_or_create(
        name=food.display_name,
        language=language,
        defaults={
            'energy': food.energy,
            'protein': Decimal(str(food.protein)),
            'carbohydrates': Decimal(str(food.carbs)),
            'fat': Decimal(str(food.fat)),
        },
    )

    plan = ensure_plan(request.user)
    entry = LogItem.objects.create(
        plan=plan,
        ingredient=ingredient,
        amount=Decimal(grams),
        datetime=timezone.now(),
        comment=f'拍照识餐 · 置信度 {photo.confidence:.0%}',
    )
    photo.log_item = entry
    photo.save(update_fields=['log_item'])

    messages.success(
        request,
        f'已记入饮食日记：{food.zh} {grams} 克（约 {food.kcal_for(grams)} 千卡）。',
    )
    return redirect('nutrition:food_ai:scan')

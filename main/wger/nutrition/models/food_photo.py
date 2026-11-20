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

# Standard Library
import pathlib
import uuid

# Django
from django.contrib.auth.models import User
from django.db import models
from django.dispatch import receiver

# wger
from wger.utils.images import validate_image_static_no_animation
from wger.utils.uuid import uuid7

# Local
from .log import LogItem


def food_photo_upload_dir(instance, filename):
    """Upload target for food scan photos"""
    return f'food-photos/{instance.user.id}/{uuid.uuid4()}{pathlib.Path(filename).suffix}'


class FoodPhoto(models.Model):
    """
    A food photo uploaded for AI recognition, with its top predictions
    """

    class Meta:
        ordering = ['-created']

    id = models.UUIDField(
        default=uuid7,
        primary_key=True,
    )

    user = models.ForeignKey(
        User,
        verbose_name='User',
        on_delete=models.CASCADE,
    )

    image = models.ImageField(
        verbose_name='Food photo',
        upload_to=food_photo_upload_dir,
        validators=[validate_image_static_no_animation],
    )

    label = models.CharField(
        max_length=50,
        verbose_name='Top prediction',
        help_text='Food-101 class key of the most likely prediction',
    )

    confidence = models.FloatField(
        verbose_name='Confidence',
        help_text='Probability of the top prediction, 0-1',
    )

    predictions = models.JSONField(
        default=list,
        verbose_name='Predictions',
        help_text='Top predictions as [{"key": ..., "prob": ...}]',
    )

    log_item = models.ForeignKey(
        LogItem,
        verbose_name='Diary entry',
        related_name='food_photos',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
    )
    """The diary entry created from this photo, if any"""

    created = models.DateTimeField(
        verbose_name='Created',
        auto_now_add=True,
    )

    def __str__(self):
        return f'Food photo {self.label} ({self.pk})'

    def get_owner_object(self):
        """
        Returns the object that has owner information
        """
        return self.user


@receiver(models.signals.post_delete, sender=FoodPhoto)
def auto_delete_file_on_delete(sender, instance: FoodPhoto, **kwargs):
    """
    Deletes the photo file when the object is deleted
    """
    if instance.image:
        instance.image.delete(save=False)

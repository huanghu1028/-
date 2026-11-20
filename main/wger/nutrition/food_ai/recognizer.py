"""
Food photo recognition with the vendored Food-101 ConvNeXt-Tiny ONNX model.

The session is created lazily on first use and shared across requests.
Preprocessing follows the model's ConvNextImageProcessor recipe: RGB,
shorter side resized to 256 (crop_pct 0.875), center crop 224, ImageNet
mean/std normalization.
"""

# Standard Library
import threading
from pathlib import Path

# Third Party
import numpy as np
import onnxruntime as ort
from PIL import Image

# wger
from wger.nutrition.food_ai.food_data import FOOD101_KEYS


MODEL_PATH = Path(__file__).resolve().parent / 'assets' / 'convnext_tiny_food101_quantized.onnx'
INPUT_SIZE = 224
RESIZE_SIZE = 256
MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)

_session = None
_lock = threading.Lock()


class RecognizerError(Exception):
    """The recognition model could not be loaded or run."""


def get_session() -> ort.InferenceSession:
    global _session
    if _session is None:
        with _lock:
            if _session is None:
                if not MODEL_PATH.is_file():
                    raise RecognizerError(f'Model file not found: {MODEL_PATH}')
                try:
                    _session = ort.InferenceSession(
                        str(MODEL_PATH), providers=['CPUExecutionProvider']
                    )
                except Exception as e:
                    raise RecognizerError(str(e)) from e
    return _session


def preprocess(image: Image.Image) -> np.ndarray:
    image = image.convert('RGB')
    scale = RESIZE_SIZE / min(image.size)
    image = image.resize(
        (max(INPUT_SIZE, round(image.width * scale)), max(INPUT_SIZE, round(image.height * scale))),
        Image.BICUBIC,
    )
    left = (image.width - INPUT_SIZE) // 2
    top = (image.height - INPUT_SIZE) // 2
    image = image.crop((left, top, left + INPUT_SIZE, top + INPUT_SIZE))
    arr = np.asarray(image, dtype=np.float32) / 255.0
    arr = (arr - MEAN) / STD
    return arr.transpose(2, 0, 1)[None, ...]


def recognize(image: Image.Image, top_k: int = 5) -> list[dict]:
    """Return the top-k predictions as [{'key': food101 class, 'prob': float}]."""
    session = get_session()
    try:
        logits = session.run(None, {'pixel_values': preprocess(image)})[0][0]
    except RecognizerError:
        raise
    except Exception as e:
        raise RecognizerError(str(e)) from e
    probs = np.exp(logits - logits.max())
    probs = probs / probs.sum()
    order = np.argsort(probs)[::-1][:top_k]
    return [{'key': FOOD101_KEYS[int(i)], 'prob': float(probs[int(i)])} for i in order]

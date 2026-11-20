"""
Local food photo recognition and meal advice.

Recognition runs on the Food-101 ConvNeXt-Tiny model by
https://huggingface.co/juan1211/pratos-convnext-tiny-food101 (Apache-2.0,
top-1 87.3% / top-5 97.8% on the 25250-image Food-101 test split), vendored
as a 34MB quantized ONNX export under assets/. Calorie values are per 100g,
curated from USDA/CIQUAL reference data and cross-checked against the
Open-food-calories dataset (https://github.com/chpalitom09-bot/Open-food-calories).
"""

"""
Nutrition reference data for the 101 Food-101 classes.

All nutrient values are per 100g of the ready-to-eat dish, curated from
USDA/CIQUAL reference values and cross-checked against the Open-food-calories
dataset (MIT, https://github.com/chpalitom09-bot/Open-food-calories).
``serving`` is a typical portion in grams, used as the default log amount.

Tags drive the meal advice pools:
light (<= ~130 kcal/100g), high_protein, staple, veg, soup, dessert,
high_fat (>= 15g fat/100g), high_energy (>= 300 kcal/100g).
"""

# Standard Library
from dataclasses import dataclass


@dataclass(frozen=True)
class FoodInfo:
    key: str
    zh: str
    en: str
    energy: int
    protein: float
    fat: float
    carbs: float
    serving: int
    tags: tuple[str, ...]

    @property
    def display_name(self) -> str:
        return f'{self.zh} {self.en}'

    def kcal_for(self, grams: float) -> int:
        return round(self.energy * grams / 100)


# key, Chinese name, English name, kcal/100g, protein, fat, carbs, serving(g), tags
_ROWS = [
    ('apple_pie', '苹果派', 'Apple pie', 237, 2.4, 11, 34, 125, ('dessert',)),
    (
        'baby_back_ribs',
        '烤猪肋排',
        'Baby back ribs',
        292,
        25,
        20,
        3,
        200,
        ('high_protein', 'high_fat'),
    ),
    ('baklava', '果仁蜜饼', 'Baklava', 428, 6, 29, 38, 60, ('dessert', 'high_energy', 'high_fat')),
    (
        'beef_carpaccio',
        '生牛肉薄片',
        'Beef carpaccio',
        121,
        22,
        3,
        1,
        80,
        ('light', 'high_protein'),
    ),
    ('beef_tartare', '鞑靼牛肉', 'Beef tartare', 140, 20, 6, 2, 100, ('high_protein',)),
    ('beet_salad', '甜菜沙拉', 'Beet salad', 43, 1.6, 0.2, 9.6, 150, ('light', 'veg')),
    (
        'beignets',
        '法式炸面团',
        'Beignets',
        330,
        5,
        18,
        38,
        80,
        ('dessert', 'high_energy', 'high_fat'),
    ),
    ('bibimbap', '韩式拌饭', 'Bibimbap', 170, 7, 5, 25, 400, ('staple',)),
    ('bread_pudding', '面包布丁', 'Bread pudding', 153, 5, 4, 25, 150, ('dessert',)),
    ('breakfast_burrito', '早餐墨西哥卷', 'Breakfast burrito', 200, 9, 9, 22, 250, ()),
    ('bruschetta', '意式烤面包', 'Bruschetta', 195, 5, 7, 28, 120, ()),
    ('caesar_salad', '凯撒沙拉', 'Caesar salad', 127, 6, 9, 6, 200, ('light', 'veg')),
    ('cannoli', '卡诺里卷', 'Cannoli', 369, 7, 22, 37, 85, ('dessert', 'high_energy', 'high_fat')),
    ('caprese_salad', '卡普雷塞沙拉', 'Caprese salad', 160, 8, 12, 5, 180, ('veg',)),
    (
        'carrot_cake',
        '胡萝卜蛋糕',
        'Carrot cake',
        326,
        4,
        18,
        38,
        100,
        ('dessert', 'high_energy', 'high_fat'),
    ),
    ('ceviche', '酸橘汁腌鱼', 'Ceviche', 120, 16, 4, 5, 150, ('light', 'high_protein')),
    (
        'cheesecake',
        '芝士蛋糕',
        'Cheesecake',
        321,
        6,
        22,
        26,
        100,
        ('dessert', 'high_energy', 'high_fat'),
    ),
    ('cheese_plate', '奶酪拼盘', 'Cheese plate', 350, 22, 28, 3, 100, ('high_energy', 'high_fat')),
    ('chicken_curry', '咖喱鸡', 'Chicken curry', 165, 14, 9, 7, 300, ('high_protein',)),
    ('chicken_quesadilla', '鸡肉芝士饼', 'Chicken quesadilla', 230, 13, 12, 18, 200, ()),
    ('chicken_wings', '烤鸡翅', 'Chicken wings', 203, 30, 8, 0, 150, ('high_protein',)),
    (
        'chocolate_cake',
        '巧克力蛋糕',
        'Chocolate cake',
        371,
        5,
        20,
        45,
        100,
        ('dessert', 'high_energy', 'high_fat'),
    ),
    ('chocolate_mousse', '巧克力慕斯', 'Chocolate mousse', 225, 4, 14, 22, 100, ('dessert',)),
    ('churros', '吉事果', 'Churros', 380, 4, 22, 42, 80, ('dessert', 'high_energy', 'high_fat')),
    ('clam_chowder', '蛤蜊浓汤', 'Clam chowder', 90, 5, 4, 9, 300, ('light', 'soup')),
    ('club_sandwich', '总会三明治', 'Club sandwich', 230, 13, 12, 18, 250, ()),
    ('crab_cakes', '蟹肉饼', 'Crab cakes', 155, 12, 8, 9, 150, ('high_protein',)),
    ('creme_brulee', '焦糖布丁', 'Creme brulee', 260, 4, 18, 22, 120, ('dessert', 'high_fat')),
    ('croque_madame', '法式火腿芝士三明治', 'Croque madame', 280, 14, 17, 18, 220, ('high_fat',)),
    ('cup_cakes', '纸杯蛋糕', 'Cup cakes', 305, 4, 14, 42, 70, ('dessert', 'high_energy')),
    ('deviled_eggs', '魔鬼蛋', 'Deviled eggs', 124, 11, 8, 2, 100, ('light', 'high_protein')),
    ('donuts', '甜甜圈', 'Donuts', 421, 5, 25, 45, 60, ('dessert', 'high_energy', 'high_fat')),
    ('dumplings', '饺子', 'Dumplings', 220, 9, 9, 26, 250, ('staple',)),
    ('edamame', '毛豆', 'Edamame', 121, 12, 5, 9, 150, ('light', 'veg', 'high_protein')),
    (
        'eggs_benedict',
        '班尼迪克蛋',
        'Eggs benedict',
        220,
        12,
        16,
        8,
        200,
        ('high_protein', 'high_fat'),
    ),
    ('escargots', '法式焗蜗牛', 'Escargots', 90, 16, 2, 2, 100, ('light', 'high_protein')),
    ('falafel', '中东炸豆丸', 'Falafel', 333, 13, 18, 32, 150, ('high_energy', 'high_fat')),
    ('filet_mignon', '菲力牛排', 'Filet mignon', 227, 26, 13, 0, 180, ('high_protein',)),
    ('fish_and_chips', '炸鱼薯条', 'Fish and chips', 250, 13, 14, 19, 350, ()),
    ('foie_gras', '鹅肝', 'Foie gras', 462, 11, 44, 4, 60, ('high_energy', 'high_fat')),
    ('french_fries', '炸薯条', 'French fries', 312, 3.4, 15, 41, 150, ('high_energy', 'high_fat')),
    ('french_onion_soup', '法式洋葱汤', 'French onion soup', 75, 3, 3, 9, 300, ('light', 'soup')),
    ('french_toast', '法式吐司', 'French toast', 229, 8, 11, 25, 150, ()),
    ('fried_calamari', '炸鱿鱼圈', 'Fried calamari', 175, 15, 8, 11, 150, ()),
    ('fried_rice', '炒饭', 'Fried rice', 163, 4, 5, 26, 350, ('staple',)),
    ('frozen_yogurt', '冷冻酸奶', 'Frozen yogurt', 127, 3, 4, 21, 150, ('dessert',)),
    ('garlic_bread', '蒜香面包', 'Garlic bread', 350, 8, 16, 44, 80, ('high_energy', 'high_fat')),
    ('gnocchi', '意式土豆团子', 'Gnocchi', 130, 3.5, 1, 27, 250, ('staple',)),
    ('greek_salad', '希腊沙拉', 'Greek salad', 90, 3, 7, 5, 250, ('light', 'veg')),
    (
        'grilled_cheese_sandwich',
        '烤芝士三明治',
        'Grilled cheese sandwich',
        300,
        12,
        17,
        26,
        150,
        ('high_energy', 'high_fat'),
    ),
    ('grilled_salmon', '烤三文鱼', 'Grilled salmon', 208, 22, 13, 0, 150, ('high_protein',)),
    ('guacamole', '牛油果酱', 'Guacamole', 160, 2, 15, 8, 60, ('high_fat',)),
    ('gyoza', '日式煎饺', 'Gyoza', 210, 8, 10, 23, 200, ()),
    ('hamburger', '汉堡包', 'Hamburger', 295, 17, 14, 24, 220, ()),
    ('hot_and_sour_soup', '酸辣汤', 'Hot and sour soup', 40, 2.5, 1.5, 4.5, 300, ('light', 'soup')),
    ('hot_dog', '热狗', 'Hot dog', 290, 11, 18, 22, 150, ('high_fat',)),
    (
        'huevos_rancheros',
        '墨西哥乡村蛋',
        'Huevos rancheros',
        180,
        9,
        12,
        10,
        250,
        ('high_protein',),
    ),
    ('hummus', '鹰嘴豆泥', 'Hummus', 166, 8, 10, 14, 60, ()),
    ('ice_cream', '冰淇淋', 'Ice cream', 207, 3.5, 11, 24, 100, ('dessert',)),
    ('lasagna', '千层面', 'Lasagna', 135, 8, 5, 15, 350, ('staple',)),
    ('lobster_bisque', '龙虾浓汤', 'Lobster bisque', 100, 6, 6, 6, 300, ('soup',)),
    (
        'lobster_roll_sandwich',
        '龙虾卷',
        'Lobster roll sandwich',
        280,
        14,
        16,
        21,
        220,
        ('high_protein', 'high_fat'),
    ),
    ('macaroni_and_cheese', '芝士通心粉', 'Macaroni and cheese', 164, 7, 7, 19, 250, ('staple',)),
    ('macarons', '马卡龙', 'Macarons', 400, 6, 20, 50, 40, ('dessert', 'high_energy', 'high_fat')),
    ('miso_soup', '味噌汤', 'Miso soup', 40, 3, 1.5, 4, 250, ('light', 'soup')),
    ('mussels', '青口贝', 'Mussels', 86, 12, 2, 4, 200, ('light', 'high_protein')),
    ('nachos', '墨西哥玉米片', 'Nachos', 306, 7, 19, 28, 150, ('high_energy', 'high_fat')),
    ('omelette', '欧姆蛋', 'Omelette', 154, 11, 12, 1.6, 200, ('high_protein',)),
    ('onion_rings', '炸洋葱圈', 'Onion rings', 332, 4, 20, 35, 120, ('high_energy', 'high_fat')),
    ('oysters', '生蚝', 'Oysters', 68, 7, 2, 4, 150, ('light', 'high_protein')),
    ('pad_thai', '泰式炒河粉', 'Pad thai', 190, 8, 8, 23, 350, ('staple',)),
    ('paella', '西班牙海鲜饭', 'Paella', 170, 10, 6, 20, 400, ('staple',)),
    ('pancakes', '松饼', 'Pancakes', 227, 6, 9, 30, 150, ()),
    ('panna_cotta', '意式奶冻', 'Panna cotta', 230, 3, 16, 20, 120, ('dessert', 'high_fat')),
    (
        'peking_duck',
        '北京烤鸭',
        'Peking duck',
        337,
        19,
        28,
        2,
        150,
        ('high_protein', 'high_energy', 'high_fat'),
    ),
    ('pho', '越南河粉', 'Pho', 130, 7, 3, 19, 500, ('staple', 'soup')),
    ('pizza', '披萨', 'Pizza', 266, 11, 10, 33, 200, ()),
    ('pork_chop', '猪排', 'Pork chop', 231, 25, 14, 0, 180, ('high_protein',)),
    ('poutine', '肉汁奶酪薯条', 'Poutine', 290, 8, 16, 30, 300, ('high_fat',)),
    ('prime_rib', '烤肋眼牛排', 'Prime rib', 291, 24, 21, 0, 200, ('high_protein', 'high_fat')),
    ('pulled_pork_sandwich', '手撕猪肉三明治', 'Pulled pork sandwich', 260, 15, 13, 22, 250, ()),
    ('ramen', '日式拉面', 'Ramen', 180, 8, 7, 22, 500, ('staple', 'soup')),
    ('ravioli', '意式饺', 'Ravioli', 175, 8, 7, 21, 250, ('staple',)),
    (
        'red_velvet_cake',
        '红丝绒蛋糕',
        'Red velvet cake',
        367,
        4,
        19,
        46,
        100,
        ('dessert', 'high_energy', 'high_fat'),
    ),
    ('risotto', '意式烩饭', 'Risotto', 158, 5, 5, 24, 300, ('staple',)),
    ('samosa', '咖喱角', 'Samosa', 262, 6, 14, 29, 100, ()),
    ('sashimi', '刺身', 'Sashimi', 130, 22, 4, 0, 120, ('light', 'high_protein')),
    ('scallops', '扇贝', 'Scallops', 88, 17, 1, 3, 150, ('light', 'high_protein')),
    ('seaweed_salad', '海藻沙拉', 'Seaweed salad', 45, 1.5, 1, 8, 100, ('light', 'veg')),
    ('shrimp_and_grits', '虾仁玉米糊', 'Shrimp and grits', 180, 12, 9, 14, 300, ('high_protein',)),
    ('spaghetti_bolognese', '肉酱意面', 'Spaghetti bolognese', 160, 8, 6, 19, 350, ('staple',)),
    (
        'spaghetti_carbonara',
        '培根蛋酱意面',
        'Spaghetti carbonara',
        210,
        9,
        11,
        20,
        350,
        ('staple',),
    ),
    ('spring_rolls', '春卷', 'Spring rolls', 140, 4, 7, 16, 120, ()),
    ('steak', '牛排', 'Steak', 271, 25, 19, 0, 200, ('high_protein', 'high_fat')),
    ('strawberry_shortcake', '草莓蛋糕', 'Strawberry shortcake', 280, 4, 12, 40, 120, ('dessert',)),
    ('sushi', '寿司', 'Sushi', 143, 6, 2, 26, 250, ('staple',)),
    ('tacos', '塔可', 'Tacos', 226, 10, 12, 20, 200, ()),
    ('takoyaki', '章鱼烧', 'Takoyaki', 180, 7, 8, 21, 180, ()),
    ('tiramisu', '提拉米苏', 'Tiramisu', 283, 5, 17, 29, 120, ('dessert', 'high_fat')),
    ('tuna_tartare', '金枪鱼塔塔', 'Tuna tartare', 130, 23, 4, 1, 120, ('light', 'high_protein')),
    ('waffles', '华夫饼', 'Waffles', 291, 7, 14, 35, 100, ('dessert',)),
]

FOODS: dict[str, FoodInfo] = {
    row[0]: FoodInfo(row[0], row[1], row[2], row[3], row[4], row[5], row[6], row[7], row[8])
    for row in _ROWS
}

# The model outputs logits in Food-101 class order, which is alphabetical
FOOD101_KEYS: list[str] = sorted(FOODS)


def foods_with_tag(tag: str, max_energy: int | None = None) -> list[FoodInfo]:
    """Foods carrying a tag, optionally capped by energy, sorted by energy."""
    result = [f for f in FOODS.values() if tag in f.tags]
    if max_energy is not None:
        result = [f for f in result if f.energy <= max_energy]
    return sorted(result, key=lambda f: (f.energy, f.key))

/** Category taxonomy (spec decision 12): design boards + business/facility services + car services + IT support. */
export interface CategorySeed {
  slug: string;
  az: string;
  ru: string;
  en: string;
  icon: string;
  featured?: boolean;
  flow?: 'INSTANT' | 'QUOTE';
  emergencyAllowed?: boolean;
  keywords?: string[];
}

export interface CategoryGroupSeed extends CategorySeed {
  vertical: 'HOME' | 'AUTO';
  children: CategorySeed[];
}

export const CATEGORY_TREE: CategoryGroupSeed[] = [
  {
    slug: 'home-systems', vertical: 'HOME', az: 'Ev sistemləri', ru: 'Инженерные системы', en: 'Home systems', icon: 'home-lightning-bolt',
    children: [
      { slug: 'plumbing', az: 'Santexnik', ru: 'Сантехник', en: 'Plumber', icon: 'pipe-wrench', featured: true, keywords: ['kran', 'su', 'boru', 'unitaz', 'sızma', 'santexnika', 'kanalizasiya', 'кран', 'труба', 'унитаз', 'течь', 'сантехника', 'faucet', 'pipe', 'leak', 'toilet', 'sink'] },
      { slug: 'electrical', az: 'Elektrik', ru: 'Электрик', en: 'Electrician', icon: 'flash', featured: true, keywords: ['rozetka', 'işıq', 'açar', 'kabel', 'qısa qapanma', 'розетка', 'свет', 'проводка', 'выключатель', 'socket', 'outlet', 'wiring', 'light', 'switch'] },
      { slug: 'air-conditioning', az: 'Kondisioner', ru: 'Кондиционеры', en: 'Air conditioning', icon: 'air-conditioner', featured: true, keywords: ['kondisioner', 'freon', 'soyutmur', 'кондиционер', 'фреон', 'сплит', 'air conditioner', 'ac', 'split'] },
      { slug: 'heating', az: 'Kombi / istilik', ru: 'Котлы и отопление', en: 'Boilers & heating', icon: 'radiator', keywords: ['kombi', 'radiator', 'istilik', 'котёл', 'батарея', 'отопление', 'boiler', 'radiator', 'heating'] },
      { slug: 'doors-locks', az: 'Qapı-kilid', ru: 'Двери, окна и замки', en: 'Doors, windows & locks', icon: 'door-closed-lock', featured: true, keywords: ['qapı', 'kilid', 'pəncərə', 'açar', 'дверь', 'замок', 'окно', 'ключ', 'door', 'lock', 'window', 'key'] },
      { slug: 'blinds-curtains', az: 'Jalüz və pərdə', ru: 'Жалюзи и шторы', en: 'Blinds & curtains', icon: 'blinds', keywords: ['jalüz', 'pərdə', 'karniz', 'жалюзи', 'шторы', 'карниз', 'blinds', 'curtains'] },
    ],
  },
  {
    slug: 'appliances', vertical: 'HOME', az: 'Texnika təmiri', ru: 'Ремонт техники', en: 'Appliance repair', icon: 'washing-machine',
    children: [
      { slug: 'home-appliances', az: 'Məişət texnikası', ru: 'Бытовая техника', en: 'Household appliances', icon: 'washing-machine', keywords: ['paltaryuyan', 'soyuducu', 'qabyuyan', 'soba', 'стиральная машина', 'холодильник', 'посудомойка', 'washing machine', 'fridge', 'dishwasher', 'oven'] },
      { slug: 'tv-electronics', az: 'TV / elektronika', ru: 'ТВ и электроника', en: 'TV & electronics', icon: 'television', keywords: ['televizor', 'ekran', 'телевизор', 'экран', 'tv', 'television', 'screen'] },
      { slug: 'cctv-security', az: 'Kamera / təhlükəsizlik', ru: 'Камеры и охрана', en: 'CCTV & security', icon: 'cctv', keywords: ['kamera', 'domofon', 'siqnalizasiya', 'камера', 'домофон', 'сигнализация', 'camera', 'intercom', 'alarm'] },
      { slug: 'internet-network', az: 'İnternet / şəbəkə', ru: 'Интернет и сеть', en: 'Internet & network', icon: 'router-wireless', keywords: ['internet', 'modem', 'router', 'интернет', 'роутер', 'модем', 'network'] },
    ],
  },
  {
    slug: 'finishing', vertical: 'HOME', az: 'Tamamlama və dizayn', ru: 'Отделка и дизайн', en: 'Finishing & design', icon: 'palette',
    children: [
      { slug: 'painting', az: 'Malyar', ru: 'Маляр', en: 'Painter', icon: 'format-paint', featured: true, keywords: ['boya', 'rəngləmə', 'divar', 'краска', 'покраска', 'стены', 'paint', 'painting', 'wall'] },
      { slug: 'furniture', az: 'Mebel ustası', ru: 'Мебельщик', en: 'Furniture assembly & repair', icon: 'sofa', featured: true, keywords: ['mebel', 'şkaf', 'yığma', 'мебель', 'шкаф', 'сборка', 'furniture', 'wardrobe', 'assembly'] },
      { slug: 'wallpaper', az: 'Oboy / divar kağızı', ru: 'Поклейка обоев', en: 'Wallpapering', icon: 'wallpaper', keywords: ['oboy', 'обои', 'wallpaper'] },
      { slug: 'gardening', az: 'Bağban / həyət işləri', ru: 'Садовник и двор', en: 'Gardening & yard', icon: 'flower', emergencyAllowed: false, keywords: ['bağ', 'ağac', 'qazon', 'сад', 'газон', 'деревья', 'garden', 'lawn', 'trees'] },
    ],
  },
  {
    slug: 'construction', vertical: 'HOME', az: 'Tikinti və təmir', ru: 'Строительство и ремонт', en: 'Construction & renovation', icon: 'hammer-wrench',
    children: [
      { slug: 'renovation-crew', az: 'Tikinti-təmir briqadası', ru: 'Ремонтная бригада', en: 'Renovation crew', icon: 'account-hard-hat', flow: 'QUOTE', emergencyAllowed: false, keywords: ['təmir', 'briqada', 'ремонт', 'бригада', 'renovation', 'crew'] },
      { slug: 'tiling', az: 'Kafel-metlax', ru: 'Укладка плитки', en: 'Tiling', icon: 'view-grid', keywords: ['kafel', 'metlax', 'плитка', 'кафель', 'tile', 'tiling'] },
      { slug: 'drywall', az: 'Alçıpan / asma tavan', ru: 'Гипсокартон и потолки', en: 'Drywall & ceilings', icon: 'wall', keywords: ['alçıpan', 'tavan', 'гипсокартон', 'потолок', 'drywall', 'ceiling'] },
      { slug: 'plastering', az: 'Suvaq-beton işləri', ru: 'Штукатурка и бетон', en: 'Plaster & concrete', icon: 'layers', keywords: ['suvaq', 'beton', 'штукатурка', 'бетон', 'plaster', 'concrete'] },
      { slug: 'carpentry', az: 'Dülgər / xarrat', ru: 'Плотник и столяр', en: 'Carpenter', icon: 'saw-blade', keywords: ['dülgər', 'xarrat', 'taxta', 'плотник', 'столяр', 'дерево', 'carpenter', 'wood'] },
      { slug: 'roofing', az: 'Dam örtüyü', ru: 'Кровельные работы', en: 'Roofing', icon: 'home-roof', flow: 'QUOTE', emergencyAllowed: false, keywords: ['dam', 'örtük', 'крыша', 'кровля', 'roof', 'roofing'] },
      { slug: 'welding', az: 'Qaynaqçı / dəmir işləri', ru: 'Сварка и металлоконструкции', en: 'Welding & metalwork', icon: 'fire', keywords: ['qaynaq', 'dəmir', 'сварка', 'металл', 'welding', 'metal'] },
      { slug: 'flooring', az: 'Parket / döşəmə', ru: 'Паркет и полы', en: 'Parquet & flooring', icon: 'floor-plan', keywords: ['parket', 'laminat', 'döşəmə', 'паркет', 'ламинат', 'пол', 'parquet', 'laminate', 'floor'] },
    ],
  },
  {
    slug: 'it-support', vertical: 'HOME', az: 'IT dəstək', ru: 'IT-поддержка', en: 'IT support', icon: 'laptop',
    children: [
      { slug: 'computer-repair', az: 'Kompüter və noutbuk təmiri', ru: 'Ремонт компьютеров и ноутбуков', en: 'Computer & laptop repair', icon: 'laptop', keywords: ['kompüter', 'noutbuk', 'virus', 'компьютер', 'ноутбук', 'вирус', 'computer', 'laptop', 'pc'] },
      { slug: 'wifi-setup', az: 'Wi-Fi və şəbəkə quraşdırılması', ru: 'Настройка Wi-Fi и сети', en: 'Wi-Fi & network setup', icon: 'wifi', keywords: ['wifi', 'şəbəkə', 'сеть', 'вайфай', 'wi-fi', 'network'] },
      { slug: 'printers-office', az: 'Printer və ofis texnikası', ru: 'Принтеры и оргтехника', en: 'Printers & office equipment', icon: 'printer', keywords: ['printer', 'skaner', 'kartric', 'принтер', 'сканер', 'картридж', 'printer', 'scanner', 'cartridge'] },
      { slug: 'software-setup', az: 'Proqram təminatı quraşdırılması', ru: 'Установка программ', en: 'Software installation', icon: 'application-cog', keywords: ['proqram', 'windows', 'программа', 'windows', 'software', 'install'] },
      { slug: 'smart-home', az: 'Smart ev və TV quraşdırılması', ru: 'Умный дом и ТВ', en: 'Smart home & TV setup', icon: 'home-automation', keywords: ['smart', 'ağıllı ev', 'умный дом', 'smart home', 'tv mount'] },
    ],
  },
  {
    slug: 'business', vertical: 'HOME', az: 'Biznes və obyekt xidmətləri', ru: 'Обслуживание бизнеса и объектов', en: 'Business & facility services', icon: 'office-building',
    children: [
      { slug: 'office-maintenance', az: 'Ofis texniki xidməti', ru: 'Техобслуживание офиса', en: 'Office maintenance', icon: 'office-building-cog', keywords: ['ofis', 'офис', 'office', 'maintenance'] },
      { slug: 'hvac-commercial', az: 'Ventilyasiya və istilik sistemləri', ru: 'Вентиляция и отопление', en: 'Ventilation & HVAC', icon: 'hvac', keywords: ['ventilyasiya', 'вентиляция', 'hvac', 'ventilation'] },
      { slug: 'commercial-refrigeration', az: 'Soyuducu avadanlıq', ru: 'Холодильное оборудование', en: 'Commercial refrigeration', icon: 'fridge-industrial', keywords: ['vitrin', 'soyuducu kamera', 'холодильная камера', 'витрина', 'refrigeration', 'freezer'] },
      { slug: 'structured-cabling', az: 'Struktur kabel şəbəkəsi', ru: 'Структурированные кабельные сети', en: 'Structured cabling', icon: 'lan', keywords: ['kabel', 'lan', 'кабель', 'скс', 'cabling', 'ethernet'] },
      { slug: 'fire-alarm', az: 'Yanğın siqnalizasiyası', ru: 'Пожарная сигнализация', en: 'Fire alarm systems', icon: 'fire-alert', keywords: ['yanğın', 'пожарная', 'fire alarm'] },
      { slug: 'generator-ups', az: 'Generator və UPS', ru: 'Генераторы и ИБП', en: 'Generators & UPS', icon: 'flash-triangle', keywords: ['generator', 'ups', 'генератор', 'ибп'] },
      { slug: 'commercial-cleaning', az: 'Peşəkar təmizlik', ru: 'Профессиональная уборка', en: 'Professional cleaning', icon: 'broom', emergencyAllowed: false, keywords: ['təmizlik', 'уборка', 'клининг', 'cleaning'] },
      { slug: 'facility-renovation', az: 'Obyekt təmiri (layihə)', ru: 'Ремонт объектов (проект)', en: 'Facility renovation (project)', icon: 'account-hard-hat', flow: 'QUOTE', emergencyAllowed: false, keywords: ['obyekt', 'mağaza', 'restoran', 'объект', 'магазин', 'ресторан', 'shop', 'restaurant', 'renovation'] },
    ],
  },
  {
    slug: 'roadside', vertical: 'AUTO', az: 'Yolda yardım', ru: 'Помощь на дороге', en: 'Roadside assistance', icon: 'car-emergency',
    children: [
      { slug: 'battery', az: 'Akkumulyator', ru: 'Аккумулятор', en: 'Battery & jump start', icon: 'car-battery', featured: true, keywords: ['akkumulyator', 'işə düşmür', 'аккумулятор', 'не заводится', 'battery', 'jump start'] },
      { slug: 'tire', az: 'Təkər / Vulkanizasiya', ru: 'Шиномонтаж', en: 'Tyres & puncture repair', icon: 'tire', featured: true, keywords: ['təkər', 'şin', 'deşik', 'шина', 'колесо', 'прокол', 'tyre', 'tire', 'puncture'] },
      { slug: 'tow-truck', az: 'Evakuator', ru: 'Эвакуатор', en: 'Tow truck', icon: 'tow-truck', featured: true, keywords: ['evakuator', 'qəza', 'эвакуатор', 'авария', 'tow', 'accident'] },
      { slug: 'car-lockout', az: 'Avto çilingər', ru: 'Вскрытие авто', en: 'Car lockout', icon: 'car-key', keywords: ['açar içəridə', 'çilingər', 'ключи в машине', 'вскрытие', 'locked out', 'car key'] },
      { slug: 'fuel-delivery', az: 'Yanacaq çatdırılması', ru: 'Доставка топлива', en: 'Fuel delivery', icon: 'gas-station', keywords: ['benzin', 'yanacaq', 'бензин', 'топливо', 'fuel', 'petrol'] },
    ],
  },
  {
    slug: 'car-repair', vertical: 'AUTO', az: 'Avto təmir', ru: 'Авторемонт', en: 'Car repair', icon: 'car-wrench',
    children: [
      { slug: 'engine-mechanic', az: 'Motorist', ru: 'Моторист', en: 'Engine mechanic', icon: 'engine', featured: true, keywords: ['mühərrik', 'motor', 'двигатель', 'мотор', 'engine'] },
      { slug: 'auto-electric', az: 'Avtoelektrik', ru: 'Автоэлектрик', en: 'Auto electrician', icon: 'car-electric', featured: true, keywords: ['avtoelektrik', 'fara', 'автоэлектрик', 'фары', 'проводка', 'car electrics', 'headlight'] },
      { slug: 'diagnostics', az: 'Diaqnostika', ru: 'Диагностика', en: 'Diagnostics', icon: 'car-cog', featured: true, keywords: ['diaqnostika', 'check engine', 'диагностика', 'diagnostics'] },
      { slug: 'car-ac', az: 'Avto kondisioner', ru: 'Автокондиционер', en: 'Car air conditioning', icon: 'car-defrost-front', keywords: ['avto kondisioner', 'freon', 'автокондиционер', 'car ac'] },
      { slug: 'bodywork', az: 'Kuzov və rəngləmə', ru: 'Кузов и покраска', en: 'Bodywork & paint', icon: 'spray', keywords: ['kuzov', 'rəngləmə', 'əzik', 'кузов', 'покраска', 'вмятина', 'bodywork', 'dent'] },
      { slug: 'auto-glass', az: 'Avtoşüşə', ru: 'Автостёкла', en: 'Auto glass', icon: 'car-windshield', keywords: ['şüşə', 'lobovoy', 'стекло', 'лобовое', 'windshield', 'glass'] },
      { slug: 'mobile-mechanic', az: 'Səyyar usta', ru: 'Выездной механик', en: 'Mobile mechanic', icon: 'car-wrench', keywords: ['səyyar', 'yerində', 'выездной', 'на месте', 'mobile mechanic'] },
    ],
  },
];

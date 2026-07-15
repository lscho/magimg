import type { PromptTemplate } from "@/types";
import cinematicCompare from "@/assets/template-previews/cinematic-compare.jpg";
import foodEditorial from "@/assets/template-previews/food-editorial.jpg";
import interiorCompare from "@/assets/template-previews/interior-compare.jpg";
import minimalPoster from "@/assets/template-previews/minimal-poster.jpg";
import portraitStudioCompare from "@/assets/template-previews/portrait-studio-compare.jpg";
import productCleanupCompare from "@/assets/template-previews/product-cleanup-compare.jpg";
import productHero from "@/assets/template-previews/product-hero.jpg";
import watercolorCompare from "@/assets/template-previews/watercolor-compare.jpg";

export const promptTemplates: PromptTemplate[] = [
  {
    id: "t2i-product-hero",
    mode: "text-to-image",
    title: "品牌产品主视觉",
    category: "商业设计",
    description: "适合电商首页和新品发布的高质感产品摄影。",
    prompt: "高端商业产品摄影，一件极简设计的产品置于干净的几何展台中央，柔和侧逆光勾勒轮廓，材质细节清晰，背景克制，留出品牌文案区域，真实摄影质感，精致布光，高级杂志广告风格。",
    tags: ["产品", "商业", "摄影"],
    previewImage: productHero
  },
  {
    id: "t2i-food-editorial",
    mode: "text-to-image",
    title: "美食杂志封面",
    category: "摄影",
    description: "自然光与编辑感兼具的餐饮视觉。",
    prompt: "一本现代美食杂志的封面摄影，精致料理摆放在手工陶瓷餐具中，窗边自然光，食物纹理真实诱人，桌面构图有呼吸感，色彩自然，轻微胶片颗粒，编辑摄影风格，预留标题区域。",
    tags: ["美食", "杂志", "自然光"],
    previewImage: foodEditorial
  },
  {
    id: "t2i-oriental-fantasy",
    mode: "text-to-image",
    title: "东方奇幻秘境",
    category: "场景",
    description: "山水、古建与电影氛围结合的宏大场景。",
    prompt: "东方奇幻秘境，云海之上的古老山门与层叠宫殿，远处群山若隐若现，清晨金色薄雾穿过松林，画面恢宏而宁静，电影级光影，丰富空间层次，细节精致，宽幅构图。",
    tags: ["东方", "奇幻", "电影感"],
    previewImage: watercolorCompare,
    previewCrop: "effect"
  },
  {
    id: "t2i-city-night",
    mode: "text-to-image",
    title: "雨夜未来都市",
    category: "场景",
    description: "具有叙事感的未来城市夜景。",
    prompt: "未来都市的雨夜街道，潮湿路面反射商店灯光与交通信号，行人撑伞穿过画面，建筑尺度真实，冷暖光源交错，空气中有细微雨雾，电影镜头语言，克制的科幻设计，高细节。",
    tags: ["城市", "夜景", "科幻"],
    previewImage: cinematicCompare,
    previewCrop: "effect"
  },
  {
    id: "t2i-character-sheet",
    mode: "text-to-image",
    title: "角色设定稿",
    category: "插画",
    description: "用于游戏和动画前期设计的角色展示。",
    prompt: "专业角色设定稿，同一角色的全身正面、侧面与背面视图，服装结构和配饰细节清晰，旁边展示表情与关键道具，浅灰纯色背景，干净线稿结合精细上色，统一比例，游戏概念设计文档风格。",
    tags: ["角色", "设定", "游戏"],
    previewImage: portraitStudioCompare,
    previewCrop: "effect"
  },
  {
    id: "t2i-minimal-poster",
    mode: "text-to-image",
    title: "极简艺术海报",
    category: "商业设计",
    description: "适合品牌活动与文化展览的抽象海报。",
    prompt: "现代极简艺术海报，使用大胆但克制的几何构成，清晰视觉焦点，留出充足负空间，纸张印刷质感，黑白灰为主并加入少量珊瑚红强调色，瑞士国际主义版式风格，不包含可读文字。",
    tags: ["海报", "极简", "版式"],
    previewImage: minimalPoster
  },
  {
    id: "t2i-architecture",
    mode: "text-to-image",
    title: "当代建筑摄影",
    category: "摄影",
    description: "突出建筑结构、材料和自然环境。",
    prompt: "当代建筑摄影，一座混凝土与玻璃结合的低层住宅坐落在自然坡地上，傍晚柔和天光，室内暖光透出，强调结构线条和材料质感，真实广角镜头，垂直线准确，建筑杂志摄影。",
    tags: ["建筑", "空间", "写实"],
    previewImage: interiorCompare,
    previewCrop: "effect"
  },
  {
    id: "t2i-childrens-book",
    mode: "text-to-image",
    title: "童书故事插画",
    category: "插画",
    description: "温暖、友好且富有故事性的绘本画面。",
    prompt: "温暖的儿童绘本插画，小朋友与朋友们在森林空地搭建树屋，角色动作自然有趣，柔和手绘笔触，明亮但不刺眼的配色，丰富可发现的小细节，画面充满安全感与想象力，无文字。",
    tags: ["绘本", "温暖", "故事"],
    previewImage: watercolorCompare,
    previewCrop: "effect"
  },
  {
    id: "i2i-cinematic-grade",
    mode: "image-to-image",
    title: "电影级调色",
    category: "风格转换",
    description: "保留画面内容，增强光影和叙事氛围。",
    prompt: "保留原图主体、构图和人物身份，将画面转换为电影级视觉效果，强化自然方向光和空气透视，使用克制的冷暖对比，提升材质细节与动态范围，加入细腻胶片颗粒，避免过度锐化和夸张滤镜。",
    tags: ["电影感", "调色", "光影"],
    previewImage: cinematicCompare
  },
  {
    id: "i2i-product-cleanup",
    mode: "image-to-image",
    title: "产品图精修",
    category: "产品优化",
    description: "清理背景并提升产品材质表现。",
    prompt: "严格保留原图产品外形、结构、颜色和品牌细节，清理背景杂物与瑕疵，优化边缘和材质反光，调整为专业棚拍布光，背景干净统一，阴影自然可信，输出高端电商产品摄影效果。",
    tags: ["产品", "精修", "电商"],
    previewImage: productCleanupCompare
  },
  {
    id: "i2i-portrait-studio",
    mode: "image-to-image",
    title: "自然人像棚拍",
    category: "人像",
    description: "保留人物特征，转换为专业肖像摄影。",
    prompt: "保留原图人物身份、五官比例、发型与自然表情，将环境转换为简洁专业摄影棚，使用柔和伦勃朗光，肤色真实，皮肤保留自然纹理，服装细节清晰，背景低调，避免过度磨皮与改变人物年龄。",
    tags: ["人像", "棚拍", "自然"],
    previewImage: portraitStudioCompare
  },
  {
    id: "i2i-watercolor",
    mode: "image-to-image",
    title: "透明水彩插画",
    category: "风格转换",
    description: "将原图转化为轻盈的手绘水彩。",
    prompt: "保留原图主要构图、人物姿态和关键物体，将画面转化为透明水彩插画，柔和纸张纹理，边缘自然晕染，局部留白，颜色清透且层次丰富，手绘感明确，不增加无关元素。",
    tags: ["水彩", "手绘", "轻盈"],
    previewImage: watercolorCompare
  },
  {
    id: "i2i-anime",
    mode: "image-to-image",
    title: "日系动画场景",
    category: "风格转换",
    description: "在保留空间关系的前提下动画化。",
    prompt: "保留原图场景布局、透视和主体关系，转换为高质量日系动画背景，干净线条，细腻分层上色，天空与光影富有情绪，色彩明快但协调，加入适度手绘细节，不改变原有叙事内容。",
    tags: ["动画", "场景", "日系"],
    previewImage: watercolorCompare
  },
  {
    id: "i2i-interior-daylight",
    mode: "image-to-image",
    title: "室内空间焕新",
    category: "场景优化",
    description: "保留户型结构，优化软装与光照。",
    prompt: "严格保留原图房间结构、门窗位置和空间比例，升级为现代自然风室内设计，增加协调的家具、灯具与绿植，使用柔和日光，材质真实，空间整洁但有人居感，建筑可视化摄影品质。",
    tags: ["室内", "软装", "空间"],
    previewImage: interiorCompare
  },
  {
    id: "i2i-night-to-day",
    mode: "image-to-image",
    title: "夜景转清晨",
    category: "场景优化",
    description: "保留建筑和构图，将时间转换为清晨。",
    prompt: "保留原图建筑、道路、地形和镜头构图，将夜景自然转换为清晨时分，天空有柔和蓝金渐变，低角度阳光照亮主体，阴影方向一致，空气清澈，整体真实可信，不改变场景结构。",
    tags: ["时间转换", "清晨", "建筑"],
    previewImage: cinematicCompare
  },
  {
    id: "i2i-vintage-photo",
    mode: "image-to-image",
    title: "复古胶片质感",
    category: "人像",
    description: "加入真实胶片色彩与年代氛围。",
    prompt: "保留原图人物身份、动作与场景内容，转换为上世纪胶片摄影质感，柔和高光、自然暗部层次、略微褪色的暖色调、细腻真实颗粒和轻微镜头晕光，避免明显划痕和廉价滤镜感。",
    tags: ["胶片", "复古", "人像"],
    previewImage: portraitStudioCompare
  }
];

export const templateCategories = (mode: PromptTemplate["mode"]) => [
  "全部",
  ...Array.from(new Set(promptTemplates.filter((item) => item.mode === mode).map((item) => item.category)))
];

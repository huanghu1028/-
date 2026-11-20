// 公开落地页：品牌宣传 + 功能特色 + 常见问题，无需登录。
// 视觉特效（AOS / countUp / vanilla-tilt / typewriter / rellax / Waves）由 useTigerEffects 驱动，
// 样式全部复用 globals.css 中的 tiger-* 助手类，不新增全局 CSS。
import { Link } from "react-router-dom";
import {
  Dumbbell, ClipboardList, CalendarCheck, UtensilsCrossed, Images, Bot,
  ChevronDown, ArrowRight, LogIn, UserPlus, Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import Background from "@/src/components/Background";
import { useTigerEffects } from "@/src/lib/useTigerEffects";

const STATS = [
  { value: 979, suffix: "", label: "训练动作" },
  { value: 93, suffix: "", label: "识餐菜品" },
  { value: 6, suffix: "", label: "功能模块" },
  { value: 24, suffix: "/7", label: "云端同步" },
];

const FEATURES = [
  {
    icon: Dumbbell, title: "动作库",
    desc: "979 个训练动作，中文说明配示范图，按部位、肌群与器械筛选，目标肌群图示一目了然。",
  },
  {
    icon: ClipboardList, title: "训练计划",
    desc: "自由编排训练日与动作，设定组数、次数与重量，循序渐进打造专属减脂计划。",
  },
  {
    icon: CalendarCheck, title: "训练打卡",
    desc: "跟随计划逐步完成每组训练，记录表现与感受，用打卡历史见证每一天的坚持。",
  },
  {
    icon: UtensilsCrossed, title: "体重饮食",
    desc: "体重曲线与饮食记录联动，常见菜品快速识餐录入，热量、蛋白质等营养值自动计算。",
  },
  {
    icon: Images, title: "测量画廊",
    desc: "身体围度测量与进步照片画廊，前后对比一目了然，让每一点变化都有迹可循。",
  },
  {
    icon: Bot, title: "虎教练 AI",
    desc: "内置 AI 健身教练，训练疑问、计划安排与饮食建议随时问，个性化指导一路相伴。",
  },
];

const FAQS = [
  {
    q: "如何开始使用 tiger-减脂？",
    a: "注册并登录后，先到「动作库」浏览动作、查看目标肌群图示，再到「计划」创建自己的训练计划，然后每天在「打卡」页跟着指引逐步完成训练即可。",
  },
  {
    q: "tiger-减脂 是免费的吗？",
    a: "是的，完全免费。本站是基于开源项目 wger 定制的免费开源网页版，注册后即可使用训练、饮食、体重记录等全部功能，没有付费订阅。",
  },
  {
    q: "需要下载 App 吗？",
    a: "不需要。tiger-减脂 是网页版应用，电脑或手机浏览器打开本站就能用，无需下载安装任何应用，也不占用手机存储。",
  },
  {
    q: "我的数据保存在哪里？",
    a: "训练、饮食、体重等记录都保存在云端服务器上，登录同一账号即可随时查看，24/7 多设备同步。本站程序开源，你也可以自行部署一套，把数据完全掌握在自己手中。",
  },
  {
    q: "新手友好吗？没有健身基础能用吗？",
    a: "友好。「动作库」中的动作配有中文说明与肌群图示，训练计划可以循序渐进地安排；建议新手从低强度计划开始，先熟悉动作，再逐步增加重量和组数。",
  },
  {
    q: "饮食怎么记录？",
    a: "在「饮食」页按餐次添加食物，内置常见食物成分表，系统会自动计算热量、蛋白质等营养值；配合「体重」页的趋势曲线，就能清楚看到减脂效果。",
  },
  {
    q: "虎教练 AI 能做什么？",
    a: "「虎教练」是你的 AI 健身助手，可以解答训练动作、计划安排与饮食搭配等问题，结合你的记录给出个性化建议，随时在线。",
  },
];

export default function Landing() {
  // hook 内部已在 useEffect 中按需加载并初始化全部特效脚本
  useTigerEffects();

  return (
    <div className="min-h-dvh">
      <Background />
      {/* 顶部导航 */}
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/75 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4">
          <Link to="/" className="flex items-center gap-2.5" aria-label="tiger-减脂 首页">
            <img src="/img/brand/tiger-face.svg" alt="" className="size-9 rounded-xl" />
            <span className="text-base font-bold tracking-wide">tiger-减脂</span>
          </Link>
          <nav aria-label="页内导航" className="hidden items-center gap-6 text-sm text-muted-foreground md:flex">
            <a href="#features" className="hover:text-foreground">功能特色</a>
            <a href="#faq" className="hover:text-foreground">常见问题</a>
          </nav>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" asChild className="tiger-ripple">
              <Link to="/login"><LogIn className="size-4" /> 登录</Link>
            </Button>
            <Button size="sm" asChild className="tiger-ripple tiger-shine">
              <Link to="/register"><UserPlus className="size-4" /> 注册</Link>
            </Button>
          </div>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="tiger-hero-wrap relative overflow-hidden px-4 pb-16 pt-14 sm:pt-20" aria-labelledby="hero-title">
          {/* 装饰光斑（视差） */}
          <div
            aria-hidden="true"
            data-rellax-speed="2"
            className="pointer-events-none absolute -right-24 top-10 size-72 rounded-full opacity-40 blur-3xl"
            style={{ background: "radial-gradient(closest-side, rgba(255,159,67,0.5), transparent 70%)" }}
          />
          <div className="relative mx-auto grid max-w-6xl items-center gap-10 lg:grid-cols-2">
            <div data-aos="fade-up">
              <p className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card/60 px-3 py-1 text-xs text-muted-foreground">
                <Sparkles className="size-3.5 text-primary" /> 免费开源 · 网页版 · 中文界面
              </p>
              <h1 id="hero-title" className="tiger-gradient-text header-hero-glow mt-4 text-5xl font-black tracking-tight sm:text-6xl">
                tiger-减脂
              </h1>
              <p className="mt-3 text-lg font-medium text-foreground/90 sm:text-xl">
                科学健身管理平台，练对、吃对、看见进步
              </p>
              <p className="tiger-typed-line mt-2 text-xl font-semibold" aria-live="off">
                <span id="tigerTyped">记录每一次训练</span>
              </p>
              <p className="mt-4 max-w-md text-sm leading-relaxed text-muted-foreground">
                训练计划、饮食记录、体重与进步追踪，一站式科学减脂。
                基于开源项目 wger 定制，打开浏览器即用，无需下载 App。
              </p>
              <div className="mt-7 flex flex-wrap items-center gap-3">
                <Button size="lg" asChild className="tiger-ripple tiger-shine px-7">
                  <Link to="/register">免费注册 <ArrowRight className="size-4" /></Link>
                </Button>
                <Button size="lg" variant="outline" asChild className="tiger-ripple tiger-shine px-7">
                  <Link to="/login">登录</Link>
                </Button>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">已有账号？登录后即可同步全部训练记录。</p>
            </div>
            <div className="tiger-hero-wrap mx-auto w-full max-w-sm lg:max-w-md" data-rellax-speed="-1.5">
              <img
                src="/img/brand/tiger-hero.png"
                alt="tiger-减脂 卡通老虎健身形象"
                data-tilt
                className="w-full rounded-2xl"
              />
            </div>
          </div>
        </section>

        {/* 统计带 */}
        <section className="px-4 pb-16" aria-label="平台数据一览">
          <div className="tiger-stats mx-auto max-w-5xl">
            {STATS.map((s, i) => (
              <div key={s.label} className="tiger-glass tiger-stat" data-aos="zoom-in" data-aos-delay={i * 100}>
                <div className="num tiger-gradient-text font-bold">
                  <span data-countup={s.value}>{s.value}</span>
                  {s.suffix && <span className="suffix">{s.suffix}</span>}
                </div>
                <div className="label">{s.label}</div>
              </div>
            ))}
          </div>
        </section>

        {/* 功能特色 */}
        <section id="features" className="scroll-mt-20 px-4 py-14" aria-labelledby="features-title" data-aos="fade-up">
          <div className="mx-auto max-w-6xl">
            <h2 id="features-title" className="tiger-section-h2 text-3xl font-bold">六大核心模块</h2>
            <p className="mt-4 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              从训练到饮食，从记录到对比，tiger-减脂 把减脂路上的每一步都安排明白。
            </p>
            <div className="mt-9 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((f, i) => (
                <article
                  key={f.title}
                  className="tiger-glass tiger-lift p-6"
                  data-tilt
                  data-aos="fade-up"
                  data-aos-delay={(i % 3) * 100}
                >
                  <div className="flex size-11 items-center justify-center rounded-xl bg-primary/15 text-primary">
                    <f.icon className="size-5" aria-hidden="true" />
                  </div>
                  <h3 className="mt-4 text-lg font-semibold">{f.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{f.desc}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* 常见问题 */}
        <section id="faq" className="scroll-mt-20 px-4 py-14" aria-labelledby="faq-title">
          <div className="mx-auto max-w-3xl">
            <h2 id="faq-title" className="tiger-section-h2 text-3xl font-bold" data-aos="fade-up">常见问题</h2>
            <div className="mt-9 space-y-3">
              {FAQS.map((item) => (
                <details key={item.q} className="faq-item tiger-glass group px-5 py-4" data-aos="fade-up">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
                    {item.q}
                    <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden="true" />
                  </summary>
                  <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{item.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* 底部行动号召 */}
        <section className="px-4 py-14" aria-labelledby="cta-title" data-aos="fade-up">
          <div className="tiger-glass mx-auto max-w-4xl px-6 py-12 text-center">
            <h2 id="cta-title" className="text-2xl font-bold sm:text-3xl">准备好开始改变了吗？</h2>
            <p className="mt-3 text-sm text-muted-foreground">免费注册，立刻拥有自己的训练计划与减脂档案。</p>
            <Button size="lg" asChild className="tiger-ripple tiger-shine mt-7 px-8">
              <Link to="/register">立即免费注册 <ArrowRight className="size-4" /></Link>
            </Button>
          </div>
        </section>
      </main>

      {/* 页脚 */}
      <footer className="border-t border-border px-4 py-10">
        <div className="mx-auto max-w-6xl">
          <div className="flex flex-wrap items-start justify-between gap-8">
            <div className="max-w-xs">
              <div className="flex items-center gap-2.5">
                <img src="/img/brand/tiger-face.svg" alt="tiger-减脂 logo" className="size-10 rounded-xl" />
                <span className="text-lg font-bold">tiger-减脂</span>
              </div>
              <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                免费开源的中文健身管理平台，训练、饮食、体重一站式记录，打开浏览器即用。
              </p>
            </div>
            <nav aria-label="页脚导航" className="flex flex-wrap gap-10 text-sm">
              <div>
                <h3 className="font-semibold">快速开始</h3>
                <ul className="mt-3 space-y-2 text-muted-foreground">
                  <li><Link to="/register" className="hover:text-foreground">注册账号</Link></li>
                  <li><Link to="/login" className="hover:text-foreground">登录</Link></li>
                  <li><Link to="/exercises" className="hover:text-foreground">浏览动作库</Link></li>
                </ul>
              </div>
              <div>
                <h3 className="font-semibold">了解更多</h3>
                <ul className="mt-3 space-y-2 text-muted-foreground">
                  <li><a href="#features" className="hover:text-foreground">功能特色</a></li>
                  <li><a href="#faq" className="hover:text-foreground">常见问题</a></li>
                </ul>
              </div>
            </nav>
          </div>
          <div className="mt-8 border-t border-border pt-6 text-xs leading-relaxed text-muted-foreground">
            <p>
              老虎图形来自 Twemoji（Twitter），依 CC BY 4.0 许可使用。动作图片来自 wger 贡献者（CC BY-SA）与
              free-exercise-db（公共领域）。肌肉示意图来自 Wikimedia Commons 贡献者。
              动效与交互：AOS · countUp.js · vanilla-tilt.js · Typewriter · Rellax · Waves（MIT）。
            </p>
            <p className="mt-2">© {new Date().getFullYear()} tiger-减脂 · 基于开源项目 wger 定制 · 网页版</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
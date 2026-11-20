// 客户端拍照识餐：vendored onnxruntime-web（WASM）+ Food-101 ConvNeXt-Tiny 量化模型。
// 移植自原站 wger/nutrition/food_ai/recognizer.py，全部推理在浏览器内完成，照片不上传。
// 预处理与后端一致：RGB → 短边缩放 256 → 中心裁剪 224 → /255 → ImageNet 均值方差归一化 → CHW。

/** 每 100g 营养参考值（与原站 food_data.py 的 FoodInfo 对应）。 */
export type Food101Info = {
  key: string;
  zh: string;
  en: string;
  energy: number;
  protein: number;
  fat: number;
  carbs: number;
  serving: number;
  tags: string[];
};

export type Food101Data = { keys: string[]; foods: Record<string, Food101Info> };

/** 单条识别结果：prob 为 softmax 概率（0~1）。 */
export type FoodPrediction = { key: string; prob: number; food: Food101Info };

/** 模型下载进度：percent 为 0~100。 */
export type ModelProgress = { loaded: number; total: number; percent: number };

export type ProgressCallback = (progress: ModelProgress) => void;

const ORT_URL = "/vendor/onnxruntime/ort.bundle.min.mjs";
const WASM_PATHS = "/vendor/onnxruntime/";
const MODEL_URL = "/models/food101.onnx";
const DATA_URL = "/data/food101.json";
const MODEL_BYTES = 34278923;

const RESIZE_SIZE = 256;
const INPUT_SIZE = 224;
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

// 未安装 onnxruntime-web 依赖（运行时走 public/vendor），这里只声明用到的最小结构。
type OrtTensor = { data: Float32Array; dims: readonly number[]; dispose: () => void };
type OrtSession = {
  inputNames: readonly string[];
  outputNames: readonly string[];
  run(feeds: Record<string, OrtTensor>): Promise<Record<string, OrtTensor>>;
};
type OrtModule = {
  env: { wasm: { wasmPaths: string; numThreads: number; simd: boolean } };
  Tensor: new (type: "float32", data: Float32Array, dims: readonly number[]) => OrtTensor;
  InferenceSession: {
    create(buffer: ArrayBuffer, options?: { executionProviders?: string[]; graphOptimizationLevel?: string }): Promise<OrtSession>;
  };
};

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

let ortPromise: Promise<OrtModule> | null = null;
let sessionPromise: Promise<OrtSession> | null = null;
let dataPromise: Promise<Food101Data> | null = null;

// Vite 8 对 public/ 里的 ESM 动态 import 会直接报错（字面量）或强行追加 ?import（变量，
// 即使写了 /* @vite-ignore */ 也拦不住），dev server 随后以 500 拒绝该请求。
// 这里用运行时构造的 import() 绕过打包器静态分析：浏览器按普通静态文件加载 vendored bundle，
// dev 与 build 行为一致。路径是根绝对路径，不依赖模块 base URL。
const runtimeImport = new Function("url", "return import(url)") as (url: string) => Promise<unknown>;

/** 懒加载 vendored ESM bundle（单例），配置单线程 WASM，无需 crossOriginIsolation。 */
function getOrt(): Promise<OrtModule> {
  ortPromise ??= (async () => {
    const mod = (await runtimeImport(ORT_URL)) as { default?: OrtModule } & OrtModule;
    const ort = (mod.default ?? mod) as OrtModule;
    ort.env.wasm.wasmPaths = WASM_PATHS;
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.simd = true;
    return ort;
  })().catch((e) => {
    ortPromise = null;
    throw new Error(`识别引擎加载失败：${errText(e)}`);
  });
  return ortPromise;
}

/** 食物成分表（101 道菜，中文名 + 每 100g 营养），只 fetch 一次并缓存。 */
export function loadFood101Data(): Promise<Food101Data> {
  dataPromise ??= (async () => {
    const resp = await fetch(DATA_URL);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = (await resp.json()) as Food101Data;
    if (!Array.isArray(data?.keys) || data.keys.length !== 101 || !data.foods) {
      throw new Error("数据格式不正确");
    }
    return data;
  })().catch((e) => {
    dataPromise = null;
    throw new Error(`食物数据加载失败：${errText(e)}，请刷新页面重试`);
  });
  return dataPromise;
}

/** 流式下载模型并回报进度（首次约 34MB，之后走浏览器 HTTP 缓存）。 */
async function fetchModel(onProgress?: ProgressCallback): Promise<ArrayBuffer> {
  let resp: Response;
  try {
    resp = await fetch(MODEL_URL);
  } catch (e) {
    throw new Error(`模型下载失败，请检查网络后重试（${errText(e)}）`);
  }
  if (!resp.ok) throw new Error(`模型下载失败（HTTP ${resp.status}），请稍后重试`);
  const total = Number(resp.headers.get("Content-Length")) || MODEL_BYTES;
  if (!resp.body) {
    const buf = await resp.arrayBuffer();
    onProgress?.({ loaded: buf.byteLength, total: buf.byteLength, percent: 100 });
    return buf;
  }
  const reader = resp.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      loaded += value.byteLength;
      onProgress?.({ loaded, total, percent: Math.min(100, Math.round((loaded / total) * 100)) });
    }
  }
  const bytes = new Uint8Array(loaded);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.byteLength;
  }
  return bytes.buffer;
}

/** 模型会话单例：下载 → WASM 初始化 → 建图（失败时清空缓存以便重试）。 */
function getSession(onProgress?: ProgressCallback): Promise<OrtSession> {
  sessionPromise ??= (async () => {
    const ort = await getOrt();
    const buffer = await fetchModel(onProgress);
    try {
      return await ort.InferenceSession.create(buffer, {
        executionProviders: ["wasm"],
        graphOptimizationLevel: "all",
      });
    } catch (e) {
      throw new Error(`识别模型初始化失败：${errText(e)}`);
    }
  })().catch((e) => {
    sessionPromise = null;
    throw e instanceof Error ? e : new Error(`识别模型初始化失败：${errText(e)}`);
  });
  return sessionPromise;
}

/** 图片 → 模型输入张量 [1,3,224,224]，与后端 recognizer.preprocess 等价。 */
export async function preprocess(file: File | Blob): Promise<OrtTensor> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("无法读取这张图片，请换一张 JPG / PNG 照片试试");
  }
  try {
    const { width, height } = bitmap;
    if (!width || !height) throw new Error("图片尺寸无效，请换一张照片");
    const scale = RESIZE_SIZE / Math.min(width, height);
    const rw = Math.max(INPUT_SIZE, Math.round(width * scale));
    const rh = Math.max(INPUT_SIZE, Math.round(height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = rw;
    canvas.height = rh;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("当前浏览器不支持 Canvas 2D，无法处理图片");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, rw, rh);
    const left = Math.floor((rw - INPUT_SIZE) / 2);
    const top = Math.floor((rh - INPUT_SIZE) / 2);
    const { data } = ctx.getImageData(left, top, INPUT_SIZE, INPUT_SIZE);
    const plane = INPUT_SIZE * INPUT_SIZE;
    const out = new Float32Array(3 * plane);
    for (let i = 0; i < plane; i++) {
      const p = i * 4;
      out[i] = (data[p] / 255 - MEAN[0]) / STD[0];
      out[plane + i] = (data[p + 1] / 255 - MEAN[1]) / STD[1];
      out[2 * plane + i] = (data[p + 2] / 255 - MEAN[2]) / STD[2];
    }
    const ort = await getOrt();
    return new ort.Tensor("float32", out, [1, 3, INPUT_SIZE, INPUT_SIZE]);
  } finally {
    bitmap.close();
  }
}

/**
 * 识别照片中的食物，返回概率降序的 top-5。
 * onProgress 回报模型下载进度（仅首次下载时有意义）。
 */
export async function recognizeFood(file: File | Blob, onProgress?: ProgressCallback): Promise<FoodPrediction[]> {
  const session = await getSession(onProgress);
  const data = await loadFood101Data();
  const tensor = await preprocess(file);
  let exps: Float64Array;
  let sum = 0;
  try {
    const inputName = session.inputNames[0] ?? "pixel_values";
    const results = await session.run({ [inputName]: tensor });
    const output = results[session.outputNames[0]] ?? Object.values(results)[0];
    if (!output) throw new Error("模型没有返回结果");
    const logits = output.data;
    if (logits.length !== data.keys.length) {
      throw new Error(`模型输出维度（${logits.length}）与食物数据（${data.keys.length}）不匹配`);
    }
    // softmax（减去最大值防溢出），与后端一致。
    let max = -Infinity;
    for (let i = 0; i < logits.length; i++) max = Math.max(max, logits[i]);
    exps = new Float64Array(logits.length);
    for (let i = 0; i < logits.length; i++) {
      exps[i] = Math.exp(logits[i] - max);
      sum += exps[i];
    }
    output.dispose();
  } catch (e) {
    throw new Error(`识别失败：${errText(e)}`);
  } finally {
    tensor.dispose();
  }
  const order = Array.from({ length: data.keys.length }, (_, i) => i)
    .sort((a, b) => exps[b] - exps[a])
    .slice(0, 5);
  return order.map((i) => {
    const key = data.keys[i];
    const food = data.foods[key];
    if (!food) throw new Error(`识别结果缺少食物数据：${key}`);
    return { key, prob: exps[i] / sum, food };
  });
}
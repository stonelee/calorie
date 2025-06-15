import express, { Request, Response } from 'express';
import axios from 'axios';
import cors from 'cors';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';

dotenv.config(); // Load environment variables from .env file

const app = express();
const port = 3001;

// 从 App.tsx 复制过来的常量，后续可以考虑重构为共享模块
const BAILIAN_API_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const BAILIAN_API_KEY = process.env.BAILIAN_API_KEY;
const VISION_MODEL_NAME = 'qwen-vl-max-latest';
const INFERENCE_MODEL_NAME = 'qwen-turbo';

app.use(cors());
app.use(bodyParser.json({ limit: '10mb' })); // 允许较大的 base64 图片数据

interface FoodItem {
  name: string;
  weight: string; // 食物份量，例如 "100克"
  calories: string | null;
  protein: string | null;
  fat: string | null;
  carbs: string | null;
  fiber: string | null;
}

app.post('/api/analyze-image', async (req: Request, res: Response) => {
  const { imageBase64 } = req.body as { imageBase64?: string };

  if (!imageBase64) {
    return res.status(400).json({ error: 'Missing imageBase64 in request body' });
  }

  if (!BAILIAN_API_KEY || BAILIAN_API_KEY === 'YOUR_BAILIAN_API_KEY_HERE') {
    console.error('BAILIAN_API_KEY is not configured. Please set it in your environment variables or directly in server.ts.');
    return res.status(500).json({ error: 'API Key not configured on the server.' });
  }

  try {
    // 1. 调用视觉理解大模型识别食物
    const visionResponse = await axios.post(
      `${BAILIAN_API_BASE_URL}/chat/completions`,
      {
        model: VISION_MODEL_NAME,
        messages: [
          {
            role: 'system',
            content: [{ type: 'text', text: 'You are a helpful assistant that identifies food items in an image.' }],
          },
          {
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: { url: imageBase64 }, // 客户端发送完整的 base64 字符串
              },
              {
                type: 'text',
                text: '这张图片中有什么食物？请列出所有食物的名称及其估算的份量（例如：苹果，约150克）。如果有多项，请用换行符分隔每一项。',
              },
            ],
          },
        ],
      },
      {
        headers: {
          'Authorization': `Bearer ${BAILIAN_API_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const visionResultContent = visionResponse.data?.choices?.[0]?.message?.content;
    if (typeof visionResultContent !== 'string' || !visionResultContent) {
      return res.status(500).json({ error: 'Vision model failed to return a valid result.' });
    }

    // 解析视觉模型返回的食物名称和份量，例如 "苹果，约150克\n香蕉，约100克"
    const foodEntries = visionResultContent.split('\n').map((entry: string) => entry.trim()).filter((entry: string) => entry);
    const identifiedFoods: { name: string; weight: string }[] = foodEntries.map((entry: string) => {
      const parts = entry.split(/,|，/);
      const name = parts[0]?.trim() || '未知食物';
      const weight = parts[1]?.trim() || '未知份量';
      return { name, weight };
    });

    if (identifiedFoods.length === 0) {
      return res.json({ foodItems: [] });
    }

    // 2. 调用推理模型获取所有食物的详细营养信息
    let foodItemsWithNutrition: FoodItem[] = [];
    const foodDetailsString = identifiedFoods.map((f: { name: string; weight: string }) => `${f.name} (${f.weight})`).join('；');
    const prompt = `请告诉我以下每种食物（包含份量）的卡路里、蛋白质、脂肪、碳水化合物和膳食纤维的含量：${foodDetailsString}。请按照“食物A (份量A)：卡路里XXX大卡，蛋白质YYY克，脂肪ZZZ克，碳水化合物WWW克，膳食纤维VVV克”这样的格式为每种食物单独回答，并用换行符分隔不同食物的信息。`;

    const calorieResponse = await axios.post(
      `${BAILIAN_API_BASE_URL}/chat/completions`,
      {
        model: INFERENCE_MODEL_NAME,
        messages: [
          {
            role: 'system',
            content: [{ type: 'text', text: 'You are a helpful assistant that provides calorie information for food items.' }],
          },
          {
            role: 'user',
            content: [{ type: 'text', text: prompt }],
          },
        ],
      },
      {
        headers: {
          'Authorization': `Bearer ${BAILIAN_API_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const calorieResultContent = calorieResponse.data?.choices?.[0]?.message?.content;
    if (typeof calorieResultContent === 'string' && calorieResultContent) {
      // 解析模型返回的营养信息
      // 假设返回格式： "苹果 (约150克)：卡路里80大卡，蛋白质0.5克，脂肪0.3克，碳水化合物20克，膳食纤维3克\n香蕉 (约100克)：卡路里105大卡，蛋白质1.3克，脂肪0.3克，碳水化合物27克，膳食纤维3.1克"
      const nutritionEntries = calorieResultContent.split('\n').map((entry: string) => entry.trim());
      const nutritionMap = new Map<string, Partial<FoodItem>>();

      nutritionEntries.forEach((entry: string) => {
        const foodNameMatch = entry.match(/^([^：(]+)/); // 匹配食物名称，直到冒号或左括号
        if (foodNameMatch && foodNameMatch[1]) {
          const name = foodNameMatch[1].trim();
          const nutritionData: Partial<FoodItem> = {};
          const calorieMatch = entry.match(/卡路里([^，]+大卡)/);
          if (calorieMatch && calorieMatch[1]) nutritionData.calories = calorieMatch[1].trim();
          const proteinMatch = entry.match(/蛋白质([^，]+克)/);
          if (proteinMatch && proteinMatch[1]) nutritionData.protein = proteinMatch[1].trim();
          const fatMatch = entry.match(/脂肪([^，]+克)/);
          if (fatMatch && fatMatch[1]) nutritionData.fat = fatMatch[1].trim();
          const carbsMatch = entry.match(/碳水化合物([^，]+克)/);
          if (carbsMatch && carbsMatch[1]) nutritionData.carbs = carbsMatch[1].trim();
          const fiberMatch = entry.match(/膳食纤维([^，]+克)/);
          if (fiberMatch && fiberMatch[1]) nutritionData.fiber = fiberMatch[1].trim();
          nutritionMap.set(name, nutritionData);
        }
      });

      foodItemsWithNutrition = identifiedFoods.map((food: { name: string; weight: string }) => {
        const nutrition = nutritionMap.get(food.name);
        return {
          name: food.name,
          weight: food.weight,
          calories: nutrition?.calories || '解析失败',
          protein: nutrition?.protein || '解析失败',
          fat: nutrition?.fat || '解析失败',
          carbs: nutrition?.carbs || '解析失败',
          fiber: nutrition?.fiber || '解析失败',
        };
      });
    } else {
      foodItemsWithNutrition = identifiedFoods.map((food: { name: string; weight: string }) => ({
        name: food.name,
        weight: food.weight,
        calories: '获取失败',
        protein: '获取失败',
        fat: '获取失败',
        carbs: '获取失败',
        fiber: '获取失败',
      }));
    }

    res.json({ foodItems: foodItemsWithNutrition });

  } catch (error: unknown) {
    let errorMessage = 'Failed to analyze image on the server.';
    if (axios.isAxiosError(error) && error.response) {
      console.error('Error processing image analysis (Axios):', error.response.data);
      errorMessage = error.response.data?.error?.message || error.response.data?.message || errorMessage;
    } else if (error instanceof Error) {
      console.error('Error processing image analysis:', error.message);
      errorMessage = error.message;
    } else {
      console.error('Unknown error processing image analysis:', error);
    }
    res.status(500).json({ error: errorMessage });
  }
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});

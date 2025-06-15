import express from 'express';
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
  calories: string;
}

app.post('/api/analyze-image', async (req: Request, res: Response) => {
  const { imageBase64 } = req.body;

  if (!imageBase64) {
    return res.status(400).json({ error: 'Missing imageBase64 in request body' });
  }

  if (BAILIAN_API_KEY === 'YOUR_BAILIAN_API_KEY') {
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
                text: '这张图片中有什么食物？请列出所有食物的名称，以逗号分隔。',
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
    if (!visionResultContent) {
      return res.status(500).json({ error: 'Vision model failed to return a valid result.' });
    }

    const foodNames = visionResultContent.split('，').map((name: string) => name.trim()).filter((name: string) => name);
    const identifiedFoods: { name: string }[] = foodNames.map((name: string) => ({ name }));

    if (identifiedFoods.length === 0) {
      return res.json({ foodItems: [] });
    }

    // 2. 调用推理模型获取所有食物的卡路里
    let foodItemsWithCalories: FoodItem[] = [];
    const foodNamesString = identifiedFoods.map((f: { name: string }) => f.name).join('、');
    const prompt = `请分别告诉我以下每种食物一份的卡路里大约是多少：${foodNamesString}。请按照“食物A：XXX大卡，食物B：YYY大卡”这样的格式回答。`;

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
    if (calorieResultContent) {
      const caloriePairs = calorieResultContent.split('，').map((pair: string) => pair.trim());
      const calorieMap = new Map<string, string>();
      caloriePairs.forEach((pair: string) => {
        const parts = pair.split('：');
        if (parts.length === 2) {
          calorieMap.set(parts[0].trim(), parts[1].trim());
        }
      });
      foodItemsWithCalories = identifiedFoods.map((food: { name: string }) => ({
        name: food.name,
        calories: calorieMap.get(food.name) || '解析失败',
      }));
    } else {
      foodItemsWithCalories = identifiedFoods.map((food: { name: string }) => ({ name: food.name, calories: '获取失败' }));
    }

    res.json({ foodItems: foodItemsWithCalories });

  } catch (error: any) {
    console.error('Error processing image analysis:', error.response ? error.response.data : error.message);
    res.status(500).json({ error: 'Failed to analyze image on the server.' });
  }
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});

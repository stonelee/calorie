import { useState, type ChangeEvent } from 'react';
import axios from 'axios';
import './App.css';

// 阿里云百炼 API 信息
const BAILIAN_API_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
// API Key 从环境变量 BAILIAN_API_KEY 中读取 (由 Vite 自动注入)
const BAILIAN_API_KEY = import.meta.env.BAILIAN_API_KEY;
const VISION_MODEL_NAME = 'qwen-vl-max-latest'; // 视觉理解模型
const INFERENCE_MODEL_NAME = 'qwen-turbo'; // 通用文本生成模型，用于卡路里查询，可按需更换

interface FoodItem {
  name: string;
  calories: string | null;
}

function App() {
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [foodItems, setFoodItems] = useState<FoodItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const handleImageChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setSelectedImage(reader.result as string);
        setFoodItems([]); // Clear previous results
        setError(null); // Clear previous errors
      };
      reader.readAsDataURL(file);
    }
  };

  const analyzeImage = async () => {
    console.log('selectedImage', selectedImage);
    if (!selectedImage) {
      setError('请先选择一张图片。');
      return;
    }

    setIsLoading(true);
    setError(null);

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
                  image_url: { url: selectedImage }, // 原始 base64 字符串，包含 data:image/...;base64,
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
        setError('视觉模型未能返回有效结果。');
        setFoodItems([]);
        setIsLoading(false);
        return;
      }
      // 假设模型返回的是逗号分隔的食物列表字符串
      const foodNames = visionResultContent.split('，').map((name: string) => name.trim()).filter((name: string) => name);
      const identifiedFoods = foodNames.map((name: string) => ({ name }));

      if (identifiedFoods.length === 0) {
        setFoodItems([]);
        setError('图片中未能识别出食物。');
        setIsLoading(false);
        return;
      }

      // 2. 调用推理模型获取所有食物的卡路里
      let foodItemsWithCalories: FoodItem[] = [];
      if (identifiedFoods.length > 0) {
        const foodNamesString = identifiedFoods.map((f: { name: string }) => f.name).join('、');
        const prompt = `请分别告诉我以下每种食物一份的卡路里大约是多少：${foodNamesString}。请按照“食物A：XXX大卡，食物B：YYY大卡”这样的格式回答。`;

        try {
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
            // 解析模型返回的卡路里信息
            // 这是一个简化的解析逻辑，实际可能需要更复杂的正则表达式或字符串处理
            // 假设返回格式是 "食物A：XXX大卡，食物B：YYY大卡"
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
        } catch (calorieError) {
          console.error(`获取卡路里失败:`, calorieError);
          foodItemsWithCalories = identifiedFoods.map((food: { name: string }) => ({ name: food.name, calories: '获取失败' }));
        }
      }
      setFoodItems(foodItemsWithCalories);
    } catch (err) {
      console.error('图像分析失败:', err);
      setError('图像分析失败，请检查API配置或网络连接。');
      setFoodItems([]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="container">
      <h1>食物卡路里分析器</h1>
      <div className="upload-section">
        <input type="file" accept="image/*" onChange={handleImageChange} />
        {selectedImage && (
          <div className="image-preview">
            <img src={selectedImage} alt="Selected" />
          </div>
        )}
      </div>

      {selectedImage && (
        <button onClick={analyzeImage} disabled={isLoading} className="analyze-button">
          {isLoading ? '分析中...' : '分析图片中的食物卡路里'}
        </button>
      )}

      {error && <p className="error-message">错误：{error}</p>}

      {foodItems.length > 0 && (
        <div className="results-section">
          <h2>分析结果：</h2>
          <ul>
            {foodItems.map((item, index) => (
              <li key={index}>
                <strong>{item.name}:</strong> {item.calories}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default App;

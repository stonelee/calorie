import { useState, type ChangeEvent } from 'react';
import axios from 'axios';
import './App.css'; // 复用现有的样式

interface FoodItem {
  name: string;
  calories: string;
}

const SERVER_API_URL = 'http://localhost:3001/api/analyze-image'; // Node.js 服务器地址

function ServerApp() {
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [foodItems, setFoodItems] = useState<FoodItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const handleImageChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files[0]) {
      const file = event.target.files[0];
      const reader = new FileReader();
      reader.onloadend = () => {
        setSelectedImage(reader.result as string);
        setFoodItems([]); // Reset previous results
        setError(null); // Reset previous error
      };
      reader.readAsDataURL(file);
    }
  };

  const handleAnalyze = async () => {
    if (!selectedImage) {
      setError('请先选择一张图片。');
      return;
    }

    setIsLoading(true);
    setError(null);
    setFoodItems([]);

    try {
      const response = await axios.post<{ foodItems: FoodItem[] }>(SERVER_API_URL, {
        imageBase64: selectedImage, // 发送完整的 base64 编码的图片数据
      });

      if (response.data && response.data.foodItems) {
        setFoodItems(response.data.foodItems);
        if (response.data.foodItems.length === 0) {
          setError('图片中未能识别出食物，或未能获取卡路里信息。');
        }
      } else {
        setError('未能从服务器获取有效的食物信息。');
      }
    } catch (err: any) {
      console.error('Error analyzing image via server:', err);
      setError(err.response?.data?.error || '分析图片失败，请检查服务器连接和API密钥配置。');
    }
    setIsLoading(false);
  };

  return (
    <div className="container">
      <h1>服务端卡路里分析器</h1>
      <p>
        此页面通过 Node.js 后端服务器调用阿里云百炼 API 进行食物识别和卡路里分析。
      </p>
      <div className="upload-section">
        <input type="file" accept="image/*" onChange={handleImageChange} />
        {selectedImage && (
          <div className="image-preview">
            <img src={selectedImage} alt="Selected" />
          </div>
        )}
      </div>

      {selectedImage && (
        <button onClick={handleAnalyze} disabled={isLoading} className="analyze-button">
          {isLoading ? '分析中...' : '开始分析 (通过服务器)'}
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

export default ServerApp;

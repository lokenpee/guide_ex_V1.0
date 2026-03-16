import { appManager } from '../core/appManager.js';

export class LLMApiService {
  constructor(config = {}) {
    this.config = {
      apiProvider: config.apiProvider || 'sillytavern_preset',
      apiUrl: config.apiUrl || '',
      apiKey: config.apiKey || '',
      modelName: config.modelName || '',
      tavernProfile: config.tavernProfile || '',
      temperature: Number.isFinite(Number(config.temperature)) ? Number(config.temperature) : 0.8,
      maxTokens: Number.isFinite(Number(config.maxTokens)) ? Number(config.maxTokens) : 1500,
    };
  }

  updateConfig(newConfig = {}) {
    this.config = {
      ...this.config,
      ...newConfig,
    };
  }

  async testConnection() {
    const reply = await this.callLLM('Reply with only one word: Success');
    if (String(reply || '').toLowerCase().includes('success')) {
      return `连接成功，返回: ${String(reply).slice(0, 120)}`;
    }
    throw new Error(`连接结果异常: ${String(reply || '空内容').slice(0, 120)}`);
  }

  async callLLM(prompt) {
    if (this.config.apiProvider === 'sillytavern_preset') {
      return this.#callViaSillyTavern(prompt);
    }
    return this.#callViaDirectOpenAI(prompt);
  }

  async fetchModelList() {
    if (this.config.apiProvider !== 'direct_openai') {
      return [];
    }
    if (!this.config.apiUrl || !this.config.apiKey) {
      throw new Error('请先填写 API URL 和 API Key');
    }

    const modelsUrl = this.#buildModelsUrl(this.config.apiUrl);
    const resp = await fetch(modelsUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
      },
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`获取模型失败 HTTP ${resp.status}: ${errText.slice(0, 200)}`);
    }

    const data = await resp.json();
    const list = this.#extractModels(data);
    return list
      .filter(Boolean)
      .filter((m) => typeof m === 'string')
      .map((m) => m.trim())
      .filter((m) => m.length > 0)
      .sort();
  }

  async #callViaSillyTavern(prompt) {
    if (typeof appManager.generateRaw !== 'function') {
      throw new Error('SillyTavern generateRaw 不可用');
    }
    return await appManager.generateRaw(String(prompt || ''));
  }

  async #callViaDirectOpenAI(prompt) {
    if (!this.config.apiUrl || !this.config.apiKey || !this.config.modelName) {
      throw new Error('直连模式需要完整的 API URL / API Key / Model Name');
    }

    const body = {
      model: this.config.modelName,
      messages: [{ role: 'user', content: String(prompt || '') }],
      temperature: this.config.temperature,
      max_tokens: this.config.maxTokens,
      stream: false,
    };

    const resp = await fetch(this.config.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`HTTP ${resp.status}: ${errText.slice(0, 200)}`);
    }

    const data = await resp.json();
    return data?.choices?.[0]?.message?.content || '';
  }

  #buildModelsUrl(rawUrl) {
    let url = String(rawUrl || '').trim();
    if (url.includes('/chat/completions')) {
      return url.replace('/chat/completions', '/models');
    }
    if (url.includes('/v1')) {
      return url.replace(/\/v1.*$/, '/v1/models');
    }
    return `${url.replace(/\/$/, '')}/models`;
  }

  #extractModels(data) {
    if (Array.isArray(data)) {
      return data.map((x) => x?.id || x?.model || x);
    }
    if (Array.isArray(data?.data)) {
      return data.data.map((x) => x?.id || x?.model || x);
    }
    if (Array.isArray(data?.models)) {
      return data.models.map((x) => x?.id || x?.model || x);
    }
    return [];
  }
}

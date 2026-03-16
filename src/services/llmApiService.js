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
    if (this.config.apiProvider === 'sillytavern_proxy_openai') {
      return this.#callViaSillyTavernProxy(prompt);
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
    let resp;
    try {
      resp = await fetch(modelsUrl, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
      });
    } catch (err) {
      const msg = String(err?.message || err || '');
      if (/failed to fetch|networkerror|cors/i.test(msg)) {
        throw new Error('拉取模型被浏览器拦截（可能是 CORS），可改用代理模式并手动填写模型名。');
      }
      throw err;
    }

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

  async #callViaSillyTavernProxy(prompt) {
    if (!this.config.apiUrl || !this.config.apiKey || !this.config.modelName) {
      throw new Error('代理模式需要完整的 API URL / API Key / Model Name');
    }

    const headers = {
      ...(typeof appManager.getRequestHeaders === 'function' ? appManager.getRequestHeaders() : {}),
      'Content-Type': 'application/json',
    };

    const requestData = {
      stream: false,
      messages: [{ role: 'user', content: String(prompt || '') }],
      max_tokens: this.config.maxTokens,
      model: this.config.modelName,
      temperature: this.config.temperature,
      chat_completion_source: 'openai',
      reverse_proxy: this.config.apiUrl,
      proxy_password: this.config.apiKey,
    };

    const response = await fetch('/api/backends/chat-completions/generate', {
      method: 'POST',
      headers,
      body: JSON.stringify(requestData),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`代理请求失败 HTTP ${response.status}: ${errText.slice(0, 200)}`);
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content || data?.content || '';
    if (!content) {
      throw new Error('代理模式未返回有效内容');
    }
    return content;
  }

  async #callViaDirectOpenAI(prompt) {
    if (!this.config.apiUrl || !this.config.apiKey || !this.config.modelName) {
      throw new Error('直连模式需要完整的 API URL / API Key / Model Name');
    }

    const endpoint = this.#buildChatCompletionsUrl(this.config.apiUrl);
    const body = {
      model: this.config.modelName,
      messages: [{ role: 'user', content: String(prompt || '') }],
      temperature: this.config.temperature,
      max_tokens: this.config.maxTokens,
      stream: false,
    };

    let resp;
    try {
      resp = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      const msg = String(err?.message || err || '');
      if (/failed to fetch|networkerror|cors/i.test(msg)) {
        throw new Error('直连请求被浏览器拦截（可能是 CORS）。建议切换为“通过SillyTavern代理(OpenAI兼容)”模式。');
      }
      throw err;
    }

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`HTTP ${resp.status}: ${errText.slice(0, 200)}`);
    }

    const data = await resp.json();
    return data?.choices?.[0]?.message?.content || '';
  }

  #buildModelsUrl(rawUrl) {
    const url = String(rawUrl || '').trim().replace(/\/$/, '');
    if (url.includes('/chat/completions')) {
      return url.replace('/chat/completions', '/models');
    }
    if (url.endsWith('/v1')) {
      return `${url}/models`;
    }
    if (url.includes('/v1')) {
      return url.replace(/\/v1.*$/, '/v1/models');
    }
    return `${url}/v1/models`;
  }

  #buildChatCompletionsUrl(rawUrl) {
    const url = String(rawUrl || '').trim().replace(/\/$/, '');
    if (url.endsWith('/chat/completions')) return url;
    if (url.endsWith('/v1')) return `${url}/chat/completions`;
    if (url.includes('/v1')) {
      return `${url.replace(/\/chat\/completions$/, '')}`;
    }
    return `${url}/v1/chat/completions`;
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

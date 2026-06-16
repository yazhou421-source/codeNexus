import type { CustomProviderKind, LocalCustomProvider } from "@codenexus/shared/localSettings";
import { Settings2 } from "lucide-react";
import { kindLabel, type ProviderForm } from "./helpers";

type CustomProviderConfigProps = {
  providers: LocalCustomProvider[];
  activeProviderId: string | null;
  editing: boolean;
  editingId: string | null;
  form: ProviderForm;
  testing: boolean;
  testOk: boolean;
  testMessage: string;
  canSaveProvider: boolean;
  baseUrlPlaceholder: string;
  modelPlaceholder: string;
  onActivate: (id: string) => void;
  onStartEdit: (provider: LocalCustomProvider) => void;
  onRemove: (id: string) => void;
  onStartCreate: () => void;
  onCancelEdit: () => void;
  onChangeForm: (patch: Partial<ProviderForm>) => void;
  onSave: () => void;
  onTestConnection: () => void;
};

// Provider 配置面板：左列 provider 列表（激活 / 编辑 / 删除 / 新增），右列编辑表单。
export default function CustomProviderConfig({
  providers,
  activeProviderId,
  editing,
  editingId,
  form,
  testing,
  testOk,
  testMessage,
  canSaveProvider,
  baseUrlPlaceholder,
  modelPlaceholder,
  onActivate,
  onStartEdit,
  onRemove,
  onStartCreate,
  onCancelEdit,
  onChangeForm,
  onSave,
  onTestConnection,
}: CustomProviderConfigProps) {
  return (
    <section className="cw-config app-scrollbar">
      <div className="cw-config__list">
        <h2>Providers</h2>
        {providers.length === 0 ? <p className="cw-config__hint">还没有配置任何 provider，点下方“新增”开始。</p> : null}
        {providers.map((provider) => (
          <div key={provider.id} className={`cw-provider${provider.id === activeProviderId ? " is-active" : ""}`}>
            <div className="cw-provider__info">
              <span className="cw-provider__name">{provider.name}</span>
              <span className="cw-provider__kind">{kindLabel(provider.kind)}</span>
              <span className="cw-provider__model">{provider.model || "未设置模型"}</span>
            </div>
            <div className="cw-provider__actions">
              {provider.id !== activeProviderId ? (
                <button className="cw-btn cw-btn--accent" type="button" onClick={() => onActivate(provider.id)}>
                  激活
                </button>
              ) : (
                <span className="cw-provider__current">当前</span>
              )}
              <button className="cw-btn" type="button" onClick={() => onStartEdit(provider)}>
                编辑
              </button>
              <button className="cw-btn cw-btn--danger cw-provider__remove" type="button" onClick={() => onRemove(provider.id)}>
                删除
              </button>
            </div>
          </div>
        ))}
        <button type="button" className="cw-btn cw-btn--primary cw-config__add" onClick={onStartCreate}>
          + 新增 Provider
        </button>
      </div>

      {editing ? (
        <form
          className="cw-form"
          onSubmit={(event) => {
            event.preventDefault();
            onSave();
          }}
        >
          <h2>{editingId ? "编辑 Provider" : "新增 Provider"}</h2>
          <label className="cw-field">
            <span>协议</span>
            <select value={form.kind} onChange={(event) => onChangeForm({ kind: event.target.value as CustomProviderKind })}>
              <option value="openai-compatible">OpenAI 兼容</option>
              <option value="anthropic">Claude（Anthropic）</option>
              <option value="gemini">Gemini</option>
            </select>
          </label>
          <label className="cw-field">
            <span>名称</span>
            <input value={form.name} type="text" placeholder="My Provider" onChange={(event) => onChangeForm({ name: event.target.value })} />
          </label>
          <label className="cw-field">
            <span>Base URL</span>
            <input value={form.baseUrl} type="text" placeholder={baseUrlPlaceholder} onChange={(event) => onChangeForm({ baseUrl: event.target.value })} />
          </label>
          <label className="cw-field">
            <span>API Key</span>
            <input value={form.apiKey} type="text" placeholder="sk-..." autoComplete="off" onChange={(event) => onChangeForm({ apiKey: event.target.value })} />
          </label>
          <label className="cw-field">
            <span>模型</span>
            <input value={form.model} type="text" placeholder={modelPlaceholder} onChange={(event) => onChangeForm({ model: event.target.value })} />
          </label>
          <label className="cw-field">
            <span>最大输出 tokens</span>
            <input value={form.maxOutputTokens} type="number" min="1" step="1" placeholder="留空用服务端默认" onChange={(event) => onChangeForm({ maxOutputTokens: event.target.value })} />
          </label>
          <label className="cw-field">
            <span>上下文长度（输入 tokens）</span>
            <input value={form.contextLimit} type="number" min="1" step="1" placeholder="留空不裁剪历史" onChange={(event) => onChangeForm({ contextLimit: event.target.value })} />
          </label>
          <label className="cw-check">
            <input checked={form.thinking} type="checkbox" onChange={(event) => onChangeForm({ thinking: event.target.checked })} />
            <span>启用思考 / 推理输出（支持的模型：Claude thinking · Gemini · DeepSeek-R1 等；不支持的模型请勿开启）</span>
          </label>
          <div className="cw-config__actions">
            {form.kind === "openai-compatible" ? (
              <button type="button" className="cw-btn" disabled={testing || !canSaveProvider} onClick={onTestConnection}>
                {testing ? "测试中…" : "测试连接"}
              </button>
            ) : null}
            <div className="cw-config__actions-commit">
              <button type="button" className="cw-btn" onClick={onCancelEdit}>
                取消
              </button>
              <button type="submit" className="cw-btn cw-btn--primary" disabled={!canSaveProvider}>
                保存并激活
              </button>
            </div>
          </div>
          {form.kind !== "openai-compatible" ? <p className="cw-config__hint">连接测试目前仅支持 OpenAI 兼容协议；Claude / Gemini 直接保存后在对话中验证。</p> : null}
          {testMessage ? <p className={`cw-config__test${testOk ? "" : " is-error"}`}>{testMessage}</p> : null}
        </form>
      ) : null}
    </section>
  );
}

// 头部"配置 Provider"开关按钮。
export function CustomConfigToggle({ active, onToggle }: { active: boolean; onToggle: () => void }) {
  return (
    <button type="button" className={`cw-btn${active ? " is-on" : ""}`} aria-pressed={active ? "true" : "false"} onClick={onToggle}>
      <Settings2 className="cw-btn__icon" aria-hidden="true" />
      配置 Provider
    </button>
  );
}

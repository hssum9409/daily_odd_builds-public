export function maxClaims(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 4 && number <= 20 ? number : 8;
}

const lunaModel = 'gpt-6-luna';
const solModel = 'gpt-6.1-sol';
const terraModel = 'gpt-6.1-terra';
const modelOrder = {
  auto: [terraModel, lunaModel, solModel],
  free: [lunaModel, terraModel, solModel],
  plus: [terraModel, solModel, lunaModel],
  pro: [solModel, terraModel, lunaModel],
};

export function modelPreset(value) {
  return Object.hasOwn(modelOrder, value) ? value : 'auto';
}

export function recommendedModel(models, preset) {
  const available = new Map(models.map(model => [model.id, model]));
  return modelOrder[modelPreset(preset)].map(id => available.get(id)).find(Boolean) ?? models[0];
}

export function reasoningEffort(value) {
  return ['low', 'medium', 'high'].includes(value) ? value : undefined;
}

export function recommendedEffort(model) {
  if (model === solModel) return 'high';
  if (model === terraModel || model === lunaModel) return 'medium';
}

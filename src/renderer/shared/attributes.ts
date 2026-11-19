export interface AttributeDraft {
  name: string;
  value: string;
}

const SEPARATOR = /[,،;]/;

export function parseAttributes(text: string): AttributeDraft[] {
  const parts = text.split(SEPARATOR).map((part) => part.trim()).filter(Boolean);
  const attributes = parts.map((part) => {
    const [name, ...valueParts] = part.split("=");
    return { name: name.trim(), value: valueParts.join("=").trim() };
  });
  if (attributes.some((item) => !item.name || !item.value)) {
    throw new Error("اكتب كل خاصية بصيغة الاسم=القيمة، وافصل بين الخصائص بفاصلة.");
  }
  return attributes;
}

export function attributesText(attributes: AttributeDraft[]): string {
  return attributes.map((item) => `${item.name}=${item.value}`).join("، ");
}

export function attributeSummary(attributes: AttributeDraft[]): string {
  return attributes.map((item) => `${item.name}: ${item.value}`).join("، ");
}

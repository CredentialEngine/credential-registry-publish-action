export const arrayOf = <T>(type: T | T[]): T[] => {
  if (Array.isArray(type)) {
    return type;
  }
  return [type];
};

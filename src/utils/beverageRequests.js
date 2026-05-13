export const NO_BEVERAGE = '안먹음';
export const CUSTOM_BEVERAGE = '기타';
export const DEFAULT_BEVERAGE_1 = '선식';
export const DEFAULT_BEVERAGE_2 = '아아';

export const normalizeDrinkName = (value) => String(value || '').replace(/\s+/g, ' ').trim();

export const isNoDrink = (value) => ['안먹음', '없음', '안 먹음'].includes(normalizeDrinkName(value));

export const splitDrinkText = (value) => String(value || '')
    .split(/[\n,]/)
    .map(normalizeDrinkName)
    .filter(Boolean)
    .filter((item) => !isNoDrink(item));

export const parseBeverageRequestDrinks = (request) => {
    if (!request) return [];

    const drinks = [];
    const beverage1 = normalizeDrinkName(request.beverage_1_choice);
    if (beverage1 && !isNoDrink(beverage1)) drinks.push(beverage1);

    const beverage2Choice = normalizeDrinkName(request.beverage_2_choice);
    if (beverage2Choice && !isNoDrink(beverage2Choice)) {
        if (beverage2Choice === CUSTOM_BEVERAGE) {
            drinks.push(...splitDrinkText(request.beverage_2_custom));
        } else {
            drinks.push(request.use_personal_tumbler ? `텀블러 ${beverage2Choice}` : beverage2Choice);
        }
    }

    return Array.from(new Set(drinks));
};

export const buildBeverageRequestPayload = (userId, drinkNames, requestNote = '') => {
    const names = Array.from(new Set((drinkNames || []).map(normalizeDrinkName).filter(Boolean)));
    const nativeFirst = names.find((name) => name === DEFAULT_BEVERAGE_1 || name === '해독주스');
    const remaining = nativeFirst ? names.filter((name) => name !== nativeFirst) : names;

    if (names.length === 0) {
        return {
            user_id: userId,
            beverage_1_choice: NO_BEVERAGE,
            beverage_2_choice: NO_BEVERAGE,
            beverage_2_custom: null,
            use_personal_tumbler: false,
            request_note: normalizeDrinkName(requestNote) || null
        };
    }

    if (remaining.length === 1 && remaining[0] === DEFAULT_BEVERAGE_2) {
        return {
            user_id: userId,
            beverage_1_choice: nativeFirst || NO_BEVERAGE,
            beverage_2_choice: DEFAULT_BEVERAGE_2,
            beverage_2_custom: null,
            use_personal_tumbler: false,
            request_note: normalizeDrinkName(requestNote) || null
        };
    }

    return {
        user_id: userId,
        beverage_1_choice: nativeFirst || NO_BEVERAGE,
        beverage_2_choice: remaining.length > 0 ? CUSTOM_BEVERAGE : NO_BEVERAGE,
        beverage_2_custom: remaining.length > 0 ? remaining.join('\n') : null,
        use_personal_tumbler: false,
        request_note: normalizeDrinkName(requestNote) || null
    };
};

export const formatBeverageRequestText = (request) => {
    const drinks = parseBeverageRequestDrinks(request);
    return drinks.length > 0 ? drinks.join(', ') : NO_BEVERAGE;
};

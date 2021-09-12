import {
    NavigationButton,
    RequestManager,
    SourceStateManager,
} from 'paperback-extensions-common';

async function setMangadexCredentials(
    stateManager: SourceStateManager,
    username?: string,
    password?: string
) {
    return Promise.all([
        stateManager.store('mangadexUsername', username),
        stateManager.keychain.store('mangadexPassword', password),
    ]);
}

async function getMangadexCredentials(stateManager: SourceStateManager) {
    const username =
        ((await stateManager.retrieve('mangadexUsername')) as string) ?? '';
    const password =
        ((await stateManager.keychain.retrieve(
            'mangadexPassword'
        )) as string) ?? '';
    return {
        username,
        password,
    };
}

export async function getMangadexUsername(stateManager: SourceStateManager) {
    return ((await stateManager.retrieve('mangadexUsername')) as string) ?? '';
}

async function setMangadexTokens(
    stateManager: SourceStateManager,
    token?: { session: string, refresh: string} | undefined
) {
    return Promise.all([
        stateManager.keychain.store('mangaDexAccessToken', token?.session),
        stateManager.keychain.store('mangaDexRefreshToken', token?.refresh),
    ]);
}

export async function getMangadexAccessToken(stateManager: SourceStateManager) {
    return stateManager.keychain.retrieve('mangaDexAccessToken');
}

export async function getMangadexRefreshToken(stateManager: SourceStateManager) {
    return stateManager.keychain.retrieve('mangaDexRefreshToken');
}

export async function refreshMangadex(
    stateManager: SourceStateManager,
    requestManager: RequestManager
) {
    const token = await getMangadexRefreshToken(stateManager);
    const loginResponse = await requestManager.schedule(
        createRequestObject({
            url: `https://api.mangadex.org/auth/refresh`,
            method: 'POST',
            data: {
                token,
            },
        }),
        0
    );
    const login =
        typeof loginResponse.data === 'string'
            ? JSON.parse(loginResponse.data)
            : loginResponse.data;
    return setMangadexTokens(stateManager, login?.token);
}

export async function loginToMangadex(
    stateManager: SourceStateManager,
    requestManager: RequestManager
) {
    const { username, password } = await getMangadexCredentials(stateManager);
    const loginResponse = await requestManager.schedule(
        createRequestObject({
            url: `https://api.mangadex.org/auth/login`,
            method: 'POST',
            data: {
                username,
                password,
            },
        }),
        0
    );
    const login =
        typeof loginResponse.data === 'string'
            ? JSON.parse(loginResponse.data)
            : loginResponse.data;
    return setMangadexTokens(stateManager, login?.token);
}

export async function logOut(stateManager: SourceStateManager) {
    return Promise.all([
        setMangadexTokens(stateManager, undefined),
        setMangadexCredentials(stateManager, undefined, undefined),
    ]);
}

export const loginSettings = (
    stateManager: SourceStateManager,
    requestManager: RequestManager
): NavigationButton => {
    return createNavigationButton({
        id: 'mangadex-login',
        label: 'Mangadex Login',
        value: '',
        form: createForm({
            async onSubmit(values: any) {
                await setMangadexCredentials(
                    stateManager,
                    values.mangadexUsername,
                    values.mangadexPassword
                );
                await loginToMangadex(stateManager, requestManager);
            },
            async validate() {
                return true;
            },
            async sections() {
                const values = await getMangadexCredentials(stateManager);
                return [
                    createSection({
                        id: 'information',
                        header: 'Mangadex',
                        async rows() {
                            return [
                                createMultilineLabel({
                                    label: 'Enter your Mangadex credentials',
                                    value: '',
                                    id: 'description',
                                }),
                            ];
                        },
                    }),
                    createSection({
                        id: 'mangadex-login-credentials',
                        header: '',
                        async rows() {
                            return [
                                createInputField({
                                    id: 'mangadexUsername',
                                    label: 'Username',
                                    placeholder: 'username',
                                    value: values.username,
                                    maskInput: false,
                                }),
                                createInputField({
                                    id: 'mangadexPassword',
                                    label: 'Password',
                                    placeholder: 'password',
                                    value: values.password,
                                    maskInput: true,
                                }),
                            ];
                        },
                    }),
                ];
            },
        }),
    });
};

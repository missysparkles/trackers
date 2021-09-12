/* eslint-disable @typescript-eslint/ban-ts-comment */
import {
    ContentRating,
    Form,
    PagedResults,
    SearchRequest,
    Section,
    SourceInfo,
    Tag,
    TrackerActionQueue,
    TrackedManga,
    Tracker,
    Request,
    Response,
    MangaStatus,
    MangaTile,
} from 'paperback-extensions-common';

import {
    getMangadexAccessToken,
    getMangadexUsername,
    loginSettings,
    logOut,
    refreshMangadex,
} from './MangadexLogin';

const MANGADEX_DOMAIN = 'https://mangadex.org';
const MANGADEX_API = 'https://api.mangadex.org';

export const MangadexInfo: SourceInfo = {
    name: 'Mangadex',
    author: 'Missy Sparkles',
    contentRating: ContentRating.EVERYONE,
    icon: 'icon.png',
    version: '0.0.1-rc1',
    description: 'Mangadex Tracker',
    authorWebsite: 'missysparkles.github.io',
    websiteBaseURL: MANGADEX_DOMAIN,
};

export class Mangadex extends Tracker {
    MANGADEX_DOMAIN = MANGADEX_DOMAIN;
    MANGADEX_API = MANGADEX_API;

    requestManager = createRequestManager({
        requestsPerSecond: 4,
        requestTimeout: 15000,
        interceptor: {
            // Authorization injector
            interceptRequest: async (request: Request): Promise<Request> => {
                let accessToken = await getMangadexAccessToken(this.stateManager) as string;
                if (!request.url.includes('auth') && accessToken != null) {
                    const splitToken = accessToken.split('.');
                    const body = JSON.parse(
                        Buffer.from(splitToken[1]!, 'base64').toString()
                    );
                    if (Date.now() / 1000 > body.exp) {
                        await refreshMangadex(
                            this.stateManager,
                            this.requestManager
                        );
                    }
                    accessToken = await getMangadexAccessToken(this.stateManager) as string;
                }

                request.headers = {
                    ...(request.headers ?? {}),
                    ...{
                        'content-type': 'application/json',
                        accept: 'application/json',
                    },
                    ...(accessToken != null
                        ? {
                              authorization: `Bearer ${accessToken}`,
                          }
                        : {}),
                };

                return request;
            },
            interceptResponse: async (
                response: Response
            ): Promise<Response> => {
                return response;
            },
        },
    });

    stateManager = createSourceStateManager({});

    async getSearchResults(
        query: SearchRequest,
        metadata: { offset?: number; collectedIds?: string[] }
    ): Promise<PagedResults> {
        // mostly stolen from the the real extension
        const offset: number = metadata?.offset ?? 0;
        let results: MangaTile[] = [];

        const params = {
            title: query.title,
            limit: 100,
            offset,
            'includes[]': 'cover_art',
        };
        const paramsString = Object.entries(params)
            .map(([k, v]) =>
                [`${encodeURIComponent(k)}`, `${encodeURIComponent(v!)}`].join(
                    '='
                )
            )
            .join('&');

        // skipping the ratings because we cannot get those from the other extension

        const request = createRequestObject({
            url: `${this.MANGADEX_API}/manga`,
            method: 'GET',
            param: `?${paramsString}`,
        });

        const response = await this.requestManager.schedule(request, 1);
        if (response.status != 200) {
            return createPagedResults({ results });
        }

        const json =
            typeof response.data === 'string'
                ? JSON.parse(response.data)
                : response.data;
        if (json.data === undefined) {
            throw new Error('Failed to parse json for the given search');
        }

        for (const manga of json.data) {
            const mangaId = manga.id;
            const mangaDetails = manga.attributes;
            const title = (
                Object.values(mangaDetails?.title)[0] as string
            ).replace(/&#(\d+);/g, (_m: string, d: number) =>
                String.fromCharCode(d)
            );
            const coverFileName = manga.relationships
                .filter((x: any) => x.type == 'cover_art')
                .map((x: any) => x.attributes?.fileName)[0];
            const image = coverFileName
                ? `https://uploads.mangadex.org/covers/${mangaId}/${coverFileName}.256.jpg`
                : 'https://mangadex.org/_nuxt/img/cover-placeholder.d12c3c5.jpg';

            results.push(
                createMangaTile({
                    id: mangaId,
                    title: createIconText({ text: title }),
                    image,
                })
            );
        }

        return createPagedResults({
            results,
            metadata: { offset: offset + 100 },
        });
    }

    getMangaForm(mangaId: string): Form {
        return createForm({
            sections: async () => {
                const FALLBACK_IMAGE = `https://mangadex.org/_nuxt/img/avatar.f2ff202.png`;

                const username = await getMangadexUsername(this.stateManager);

                if (username == null) {
                    return [
                        createSection({
                            id: 'notLoggedInSection',
                            rows: async () => [
                                createLabel({
                                    id: 'notLoggedIn',
                                    label: 'Not Logged In',
                                    value: undefined,
                                }),
                            ],
                        }),
                    ];
                }

                const response = await this.requestManager.schedule(
                    createRequestObject({
                        url: `${this.MANGADEX_API}/manga/${mangaId}/status`,
                        method: 'GET',
                    }),
                    1
                );

                const json =
                    typeof response.data === 'string'
                        ? JSON.parse(response.data)
                        : response.data;

                return [
                    createSection({
                        id: 'userInfo',
                        rows: async () => [
                            createHeader({
                                id: 'header',
                                imageUrl: FALLBACK_IMAGE,
                                title: username,
                                subtitle: '',
                                value: undefined,
                            }),
                        ],
                    }),
                    createSection({
                        id: 'information',
                        header: 'Information',
                        async rows() {
                            return [
                                createLabel({
                                    id: 'id',
                                    label: 'Manga ID',
                                    value: mangaId,
                                }),
                            ];
                        },
                    }),
                    createSection({
                        id: 'trackStatus',
                        header: 'Manga Status',
                        footer: 'Warning: This could mess up tracking on MD',
                        rows: async () => [
                            createSelect({
                                id: 'status',
                                value: [json.status ?? 'NONE'],
                                allowsMultiselect: false,
                                label: 'Status',
                                displayLabel: (value) => {
                                    switch (value) {
                                        case 'reading':
                                            return 'Reading';
                                        case 'plan_to_read':
                                            return 'Planned';
                                        case 'completed':
                                            return 'Completed';
                                        case 'dropped':
                                            return 'Dropped';
                                        case 'on_hold':
                                            return 'On-Hold';
                                        case 're_reading':
                                            return 'Re-Reading';
                                        default:
                                            return 'None';
                                    }
                                },
                                options: [
                                    'NONE',
                                    'reading',
                                    'on_hold',
                                    'plan_to_read',
                                    'dropped',
                                    're_reading',
                                    'completed',
                                ],
                            }),
                        ],
                    }),
                ];
            },
            onSubmit: async (values) => {
                const status = values['status']?.[0] ?? '';

                await this.requestManager.schedule(
                    createRequestObject({
                        url: `${this.MANGADEX_API}/manga/${mangaId}/status`,
                        method: 'POST',
                        data: {
                            status: status === 'NONE' ? null : status,
                        },
                    }),
                    1
                );
            },
            validate: async (_values) => true,
        });
    }

    async getTrackedManga(mangaId: string): Promise<TrackedManga> {
        const request = createRequestObject({
            url: `${this.MANGADEX_API}/manga/${mangaId}`,
            method: 'GET',
            param: `?${['author', 'artist', 'cover_art']
                .map((v) =>
                    [
                        encodeURIComponent('includes[]'),
                        encodeURIComponent(v),
                    ].join('=')
                )
                .join('&')}`,
        });

        // lifted heavily from main extension
        const response = await this.requestManager.schedule(request, 1);
        const json =
            typeof response.data === 'string'
                ? JSON.parse(response.data)
                : response.data;
        const mangaDetails = json.data.attributes;
        const titles = [
            ...Object.values(mangaDetails.title),
            ...mangaDetails.altTitles.flatMap((x: never) => Object.values(x)),
        ].map((x: string) =>
            x.replace(/&#(\d+);/g, (_m: string, d: number) =>
                String.fromCharCode(d)
            )
        );
        const desc = mangaDetails.description.en
            .replace(/&#(\d+);/g, (_m: string, d: number) =>
                String.fromCharCode(d)
            )
            .replace(/\[\/{0,1}[bus]\]/g, ''); // Get rid of BBcode tags
        let status = MangaStatus.COMPLETED;
        if (mangaDetails.status == 'ongoing') {
            status = MangaStatus.ONGOING;
        }
        const tags: Tag[] = [];
        for (const tag of mangaDetails.tags) {
            const tagName: { [index: string]: string } = tag.attributes.name;
            tags.push(
                createTag({
                    id: tag.id,
                    label:
                        Object.keys(tagName).map((keys) => tagName[keys])[0] ??
                        'Unknown',
                })
            );
        }

        const author = json.data.relationships
            .filter((x: any) => x.type == 'author')
            .map((x: any) => x.attributes.name)
            .join(', ');
        const artist = json.data.relationships
            .filter((x: any) => x.type == 'artist')
            .map((x: any) => x.attributes.name)
            .join(', ');
        const coverFileName = json.data.relationships
            .filter((x: any) => x.type == 'cover_art')
            .map((x: any) => x.attributes?.fileName)[0];
        let image: string;
        if (coverFileName) {
            image = `https://uploads.mangadex.org/covers/${mangaId}/${coverFileName}`;
        } else {
            image =
                'https://mangadex.org/_nuxt/img/cover-placeholder.d12c3c5.jpg';
        }

        return createTrackedManga({
            id: mangaId,
            mangaInfo: createMangaInfo({
                titles,
                image,
                author,
                artist,
                desc,
                rating: 5,
                status: mangaDetails.status, // wtf?
                tags: [
                    createTagSection({
                        id: 'tags',
                        label: 'Tags',
                        tags: tags,
                    }),
                ],
            }),
        });
    }

    async getSourceMenu(): Promise<Section> {
        return createSection({
            id: 'sourceMenu',
            header: 'Source Menu',
            rows: async () => {
                const accessToken = await getMangadexAccessToken(this.stateManager);
                if (accessToken != null) {
                    return [
                        createLabel({
                            id: 'userInfo',
                            label: 'Logged-in as',
                            value:
                                (await getMangadexUsername(
                                    this.stateManager
                                )) ?? 'ERROR',
                        }),
                        createButton({
                            id: 'logout',
                            label: 'Logout',
                            value: undefined,
                            onTap: async () => logOut(this.stateManager),
                        }),
                    ];
                } else
                    return [
                        loginSettings(this.stateManager, this.requestManager),
                    ];
            },
        });
    }

    async processActionQueue(actionQueue: TrackerActionQueue): Promise<void> {
        const chapterReadActions = await actionQueue.queuedChapterReadActions();
        // still untested
        for (const readAction of chapterReadActions) {
            try {
                const response = await this.requestManager.schedule(
                    createRequestObject({
                        url: `${this.MANGADEX_API}/chapter/${readAction.sourceChapterId}/read`,
                        method: 'POST',
                        data: {},
                    }),
                    0
                );

                if (response.status < 400) {
                    await actionQueue.discardChapterReadAction(readAction);
                } else {
                    await actionQueue.retryChapterReadAction(readAction);
                }
            } catch (error) {
                await actionQueue.retryChapterReadAction(readAction);
            }
        }
    }
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { TokenCredentials } from 'ms-rest';
import { Response } from 'request';
import { isArray } from 'util';
import * as vscode from 'vscode';
import { IAzureQuickPickItem } from 'vscode-azureextensionui';
import { requestUtils } from '../utils/requestUtils';
import { IStaticSiteWizardContext } from './IStaticSiteWizardContext';

export type gitHubOrgData = { login: string; repos_url: string };
export type gitHubRepoData = { name: string; repos_url: string; url: string; html_url: string };
export type gitHubBranchData = { name: string };
export type gitHubLink = { prev?: string; next?: string; last?: string; first?: string };
export type gitHubWebResource = requestUtils.Request & { nextLink?: string };

export async function getGitHubJsonResponse<T>(requestOptions: gitHubWebResource): Promise<T> {
    // Reference for GitHub REST routes
    // https://developer.github.com/v3/
    // Note: blank after user implies look up authorized user
    const gitHubResponse: Response = await requestUtils.sendRequest(requestOptions);
    if (gitHubResponse.headers.link) {
        const headerLink: string = <string>gitHubResponse.headers.link;
        const linkObject: gitHubLink = parseLinkHeaderToGitHubLinkObject(headerLink);
        requestOptions.nextLink = linkObject.next;
    }
    // tslint:disable-next-line:no-unsafe-any
    return <T>JSON.parse(gitHubResponse.body);
}

/**
 * @param label Property of JSON that will be used as the QuickPicks label
 * @param description Optional property of JSON that will be used as QuickPicks description
 * @param data Optional property of JSON that will be used as QuickPicks data saved as a NameValue pair
 */
export function createQuickPickFromJsons<T>(jsons: T[], label: string): IAzureQuickPickItem<T>[] {
    const quickPicks: IAzureQuickPickItem<T>[] = [];
    if (!isArray(jsons)) {
        jsons = [jsons];
    }

    for (const json of jsons) {
        if (!json[label]) {
            // skip this JSON if it doesn't have this label
            continue;
        }

        quickPicks.push({
            label: <string>json[label],
            data: json
        });
    }

    return quickPicks;
}

function parseLinkHeaderToGitHubLinkObject(linkHeader: string): gitHubLink {
    const linkUrls: string[] = linkHeader.split(', ');
    const linkMap: gitHubLink = {};

    // link header response is "<https://api.github.com/organizations/6154722/repos?page=2>; rel="prev", <https://api.github.com/organizations/6154722/repos?page=4>; rel="next""
    const relative: string = 'rel=';
    for (const url of linkUrls) {
        linkMap[url.substring(url.indexOf(relative) + relative.length + 1, url.length - 1)] = url.substring(url.indexOf('<') + 1, url.indexOf('>'));
    }
    return linkMap;
}

export interface ICachedQuickPicks<T> {
    picks: IAzureQuickPickItem<T>[];
}

export async function getGitHubQuickPicksWithLoadMore<T>(cache: ICachedQuickPicks<T>, requestOptions: gitHubWebResource, labelName: string, timeoutSeconds: number = 10): Promise<IAzureQuickPickItem<T | undefined>[]> {
    const timeoutMs: number = timeoutSeconds * 1000;
    const startTime: number = Date.now();
    let gitHubQuickPicks: T[] = [];
    do {
        gitHubQuickPicks = gitHubQuickPicks.concat(await getGitHubJsonResponse<T[]>(requestOptions));
        if (requestOptions.nextLink) {
            // if there is another link, set the next request url to point at that
            requestOptions.url = requestOptions.nextLink;
        }
    } while (requestOptions.nextLink && startTime + timeoutMs > Date.now());

    cache.picks = cache.picks.concat(createQuickPickFromJsons(gitHubQuickPicks, labelName));
    cache.picks.sort((a: vscode.QuickPickItem, b: vscode.QuickPickItem) => a.label.localeCompare(b.label));

    if (requestOptions.nextLink) {
        return (<IAzureQuickPickItem<T | undefined>[]>[{
            label: '$(sync) Load More',
            suppressPersistence: true,
            data: undefined
        }]).concat(cache.picks);
    } else {
        return cache.picks;
    }
}

export async function createRequestOptions(context: IStaticSiteWizardContext, url: string): Promise<gitHubWebResource> {
    if (!context.accessToken) {
        const scopes: string[] = ['repo', 'workflow', 'admin:public_key'];
        let sessions: readonly vscode.AuthenticationSession[] = await vscode.authentication.getSessions('github', scopes);
        if (sessions.length > 0) {
            context.accessToken = await sessions[0].getAccessToken();
        } else {
            await vscode.authentication.login('github', scopes);
            sessions = await vscode.authentication.getSessions('github', scopes);
            context.accessToken = await sessions[0].getAccessToken();
        }
    }

    const requestOptions: gitHubWebResource = await requestUtils.getDefaultRequest(url, new TokenCredentials(context.accessToken));
    requestOptions.resolveWithFullResponse = true;
    return requestOptions;
}

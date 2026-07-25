import React from 'react';
import { MainBanner } from '../components/MainBanner';
import { CampaignBanner } from '../components/CampaignBanner';
import { EditorialRichText } from '../components/EditorialRichText';
import { ImageAndText } from '../components/ImageAndText';
import { AmpliencePdWidget } from './AmpliencePdWidget';

function MainBannerPd(props) {
    return (
        <MainBanner
            imageUrl={props.image && props.image.url}
            heading={props.heading}
            name={props.name}
        />
    );
}

function CampaignBannerPd(props) {
    return <CampaignBanner bodyHtml={props.bannerMessage} />;
}

function EditorialRichTextPd(props) {
    return <EditorialRichText bodyHtml={props.richText} />;
}

function ImageAndTextPd(props) {
    return (
        <ImageAndText
            imageUrl={props.image && props.image.url}
            heading={props.heading}
            bodyHtml={props.text}
        />
    );
}

export function registerAmpliencePageDesignerComponents() {
    return {
        'commerce_assets.mainBanner': MainBannerPd,
        'commerce_assets.campaignBanner': CampaignBannerPd,
        'commerce_assets.editorialRichText': EditorialRichTextPd,
        'commerce_assets.imageAndText': ImageAndTextPd,
        'commerce_assets.amplienceWidget': AmpliencePdWidget
    };
}

export {
    MainBannerPd,
    CampaignBannerPd,
    EditorialRichTextPd,
    ImageAndTextPd,
    AmpliencePdWidget
};

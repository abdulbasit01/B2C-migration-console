import React from 'react';
import { MainBanner } from './MainBanner';
import { CampaignBanner } from './CampaignBanner';
import { EditorialRichText } from './EditorialRichText';
import { ImageAndText } from './ImageAndText';
import { AmplienceWidget } from './AmplienceWidget';

var WIDGET_MAP = {
    mainBanner: MainBanner,
    campaignBanner: CampaignBanner,
    editorialRichText: EditorialRichText,
    imageAndText: ImageAndText,
    amplienceWidget: AmplienceWidget
};

export function AmplienceRenderer({ model }) {
    if (!model) return null;
    var Component = WIDGET_MAP[model.widgetType] || AmplienceWidget;
    return <Component {...model} />;
}

export { WIDGET_MAP };

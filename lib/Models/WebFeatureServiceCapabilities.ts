import { createTransformer } from "mobx-utils";
import defined from "terriajs-cesium/Source/Core/defined";
import xml2json from "../ThirdParty/xml2json";
import loadXML from "../Core/loadXML";
import TerriaError from "../Core/TerriaError";
import isReadOnlyArray from "../Core/isReadOnlyArray";
import Rectangle from "terriajs-cesium/Source/Core/Rectangle";
import StratumFromTraits from "./StratumFromTraits";
import { RectangleTraits } from "../Traits/MappableTraits";
import {
  CapabilitiesService,
  CapabilitiesLatLonBoundingBox,
  CapabilitiesGeographicBoundingBox,
  CapabilitiesExtent
} from "./WebMapServiceCapabilities";
import { computed } from "mobx";
import isDefined from "../Core/isDefined";

export interface FeatureType {
  readonly Name?: string;
  readonly Title: string;
  readonly Abstract?: string;
  readonly WGS84BoundingBox?: CapabilitiesGeographicBoundingBox;
  readonly Keywords?: string | string[];
}

export function getRectangleFromLayer(
  layer: FeatureType
): StratumFromTraits<RectangleTraits> | undefined {
  var bbox = layer.WGS84BoundingBox;
  if (bbox) {
    return {
      west: bbox.westBoundLongitude,
      south: bbox.southBoundLatitude,
      east: bbox.eastBoundLongitude,
      north: bbox.northBoundLatitude
    };
  }
  return undefined;
}

export default class WebFeatureServiceCapabilities {
  static fromUrl: (
    url: string
  ) => Promise<WebFeatureServiceCapabilities> = createTransformer(
    (url: string) => {
      return Promise.resolve(loadXML(url)).then(function(capabilitiesXml) {
        const json = xml2json(capabilitiesXml);
        if (!defined(json.ServiceIdentification)) {
          throw new TerriaError({
            title: "Invalid GetCapabilities",
            message:
              `The URL ${url} was retrieved successfully but it does not appear to be a valid Web Feature Service (WFS) GetCapabilities document.` +
              `\n\nEither the catalog file has been set up incorrectly, or the server address has changed.`
          });
        }

        return new WebFeatureServiceCapabilities(capabilitiesXml, json);
      });
    }
  );

  /**
   * Get CapabilitiesService (in WMS form)
   */
  get Service(): CapabilitiesService {
    const serviceProviderJson = this.json["ServiceProvider"];
    const serviceIdentificationJson = this.json["ServiceIdentification"];
    const serviceAddressJson =
      serviceProviderJson?.["ServiceContact"]?.["ContactInfo"]?.["Address"];
    const service: CapabilitiesService = {
      Title: serviceIdentificationJson?.["Title"],
      Abstract: serviceIdentificationJson?.["Abstract"],
      Fees: serviceIdentificationJson?.["Fees"],
      AccessConstraints: serviceIdentificationJson?.["AccessConstraints"],
      KeywordList: {
        Keyword: serviceIdentificationJson?.["Keywords"]?.["Keyword"]
      },
      ContactInformation: {
        ContactPersonPrimary: {
          ContactPerson:
            serviceProviderJson?.["ServiceContact"]?.["IndividualName"],
          ContactOrganization: serviceProviderJson?.["ProviderName"]
        },
        ContactPosition:
          serviceProviderJson?.["ServiceContact"]?.["PositionName"],
        ContactAddress: {
          Address: serviceAddressJson?.["DeliveryPoint"],
          City: serviceAddressJson?.["City"],
          StateOrProvince: serviceAddressJson?.["AdministrativeArea"],
          PostCode: serviceAddressJson?.["PostalCode"],
          Country: serviceAddressJson?.["Country"]
        },
        ContactVoiceTelephone:
          serviceProviderJson?.["ServiceContact"]?.["ContactInfo"]?.["Phone"]?.[
            "Voice"
          ],
        ContactFacsimileTelephone:
          serviceProviderJson?.["ServiceContact"]?.["ContactInfo"]?.["Phone"]?.[
            "Facsimile"
          ],
        ContactElectronicMailAddress:
          serviceProviderJson?.["ServiceContact"]?.["ContactInfo"]?.[
            "Address"
          ]?.["ElectronicMailAddress"]
      }
    };
    return service;
  }

  get featureTypes(): FeatureType[] {
    const featureTypesJson = this.json.FeatureTypeList?.FeatureType as Array<
      any
    >;
    if (!isDefined(featureTypesJson) || !Array.isArray(featureTypesJson)) {
      return [];
    }
    return (
      featureTypesJson.map<FeatureType>((json: any) => {
        const lowerCorner = json["WGS84BoundingBox"]?.["LowerCorner"].split(
          " "
        );
        const upperCorner = json["WGS84BoundingBox"]?.["UpperCorner"].split(
          " "
        );

        return {
          Title: json.Title,
          Name: json.Name,
          Abstract: json.Abstract,
          Keyword: json["Keywords"]?.["Keyword"],
          WGS84BoundingBox: {
            westBoundLongitude: lowerCorner && parseFloat(lowerCorner[0]),
            southBoundLatitude: lowerCorner && parseFloat(lowerCorner[1]),
            eastBoundLongitude: upperCorner && parseFloat(upperCorner[0]),
            northBoundLatitude: upperCorner && parseFloat(upperCorner[1])
          }
        };
      }) || []
    );
  }

  private constructor(readonly xml: XMLDocument, readonly json: any) {}

  /**
   * Finds the layer in GetCapabilities corresponding to a given layer name. Names are
   * resolved as foll
   *    * The layer has the exact name specified.
   *    * The layer name matches the name in the spec if the namespace portion is removed.
   *    * The name in the spec matches the title of the layer.
   *
   * @param {String} name The layer name to resolve.
   * @returns {CapabilitiesLayer} The resolved layer, or `undefined` if the layer name could not be resolved.
   */
  findLayer(name: string): FeatureType | undefined {
    // Look for an exact match on the name.
    let match = this.featureTypes.find(ft => ft.Name === name);
    if (!match) {
      const colonIndex = name.indexOf(":");
      if (colonIndex >= 0) {
        // This looks like a namespaced name.  Such names will (usually?) show up in GetCapabilities
        // as just their name without the namespace qualifier.
        const nameWithoutNamespace = name.substring(colonIndex + 1);
        match = this.featureTypes.find(ft => ft.Name === nameWithoutNamespace);
      }
    }

    if (!match) {
      // Try matching by title.
      match = this.featureTypes.find(ft => ft.Title === name);
    }

    return match;
  }
}
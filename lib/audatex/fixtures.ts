export const AUDAVIN_GET_CAR_BY_VIN_RESPONSE = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <soap:Body>
    <GetCarByVinWsResponse xmlns="http://TE5.ibs-expert.cz/">
      <GetCarByVinWsResult>
        <IbsCode>965392</IbsCode>
        <AdditionalEquipmentsCodes>
          <string>K4N</string>
          <string>L10</string>
          <string>K43</string>
          <string>K73</string>
          <string>K54</string>
          <string>B1T</string>
          <string>B51</string>
          <string>B17</string>
        </AdditionalEquipmentsCodes>
        <AdditionalPacketCodes>
          <string>4808</string>
          <string>4816</string>
        </AdditionalPacketCodes>
        <FirstRegistrationDate>2021-04-15T00:00:00</FirstRegistrationDate>
        <Engine>1997</Engine>
        <Kw>180</Kw>
        <FuelType>Petrol</FuelType>
      </GetCarByVinWsResult>
    </GetCarByVinWsResponse>
  </soap:Body>
</soap:Envelope>`;

export const AUDAVALUATION_EVALUATE_CAR_RESPONSE = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <soap:Body>
    <EvaluateCarFullResponse xmlns="http://TE5.ibs-expert.cz/">
      <EvaluateCarFullResult>
        <Id>965392</Id>
        <CVv>208909.00</CVv>
        <COBv>124500.00</COBv>
        <THv>121000.00</THv>
        <CCv>115000.00</CCv>
      </EvaluateCarFullResult>
    </EvaluateCarFullResponse>
  </soap:Body>
</soap:Envelope>`;

export const VEHICLE_DATA_CLASSIFICATION_RESPONSE = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <soap:Body>
    <GetClassificationByIBSCodeResponse xmlns="http://TE5.ibs-expert.cz/">
      <GetClassificationByIBSCodeResult>
        <ResultedTypes>
          <CarInfo>
            <Id>965392</Id>
            <Parameteres>
              <Parameter>
                <Value>BMW</Value>
                <Description>manufacturerName</Description>
                <Id>286</Id>
              </Parameter>
              <Parameter>
                <Value>Seria 4 Coupé F32</Value>
                <Description>modelName</Description>
                <Id>288</Id>
              </Parameter>
              <Parameter>
                <Value>428i xDrive (A8)</Value>
                <Description>typeName</Description>
                <Id>289</Id>
              </Parameter>
              <Parameter>
                <Value>PL</Value>
                <Description>marketCode</Description>
                <Id>290</Id>
              </Parameter>
            </Parameteres>
          </CarInfo>
          <Equipment>
            <EquipmentType>Standard</EquipmentType>
            <Code>B21</Code>
            <Name>Bezpieczeństwo - Immobilizer</Name>
            <Nr>1</Nr>
          </Equipment>
          <Equipment>
            <EquipmentType>Standard</EquipmentType>
            <Code>J60</Code>
            <Name>Blokada mechanizmu różnicowego</Name>
            <Nr>1</Nr>
          </Equipment>
          <Equipment>
            <EquipmentType>Optional</EquipmentType>
            <Code>K73</Code>
            <Name>Czujnik deszczu i zmierzchu</Name>
            <Nr>1</Nr>
          </Equipment>
          <Equipment>
            <EquipmentType>Optional</EquipmentType>
            <Code>B1T</Code>
            <Name>Czujniki parkowania z przodu i z tyłu</Name>
            <Nr>1</Nr>
          </Equipment>
          <Equipment>
            <EquipmentType>Optional</EquipmentType>
            <Code>B1O</Code>
            <Name>Automatyczne sterowanie światłami drogowymi</Name>
            <Nr>1</Nr>
          </Equipment>
        </ResultedTypes>
      </GetClassificationByIBSCodeResult>
    </GetClassificationByIBSCodeResponse>
  </soap:Body>
</soap:Envelope>`;

export const CHE_HAS_HISTORY_POSITIVE_RESPONSE = `<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/">
  <SOAP-ENV:Header/>
  <SOAP-ENV:Body>
    <ns2:hasHistoryResponse xmlns:ns2="urn:HistoryWSDL">
      <ns2:hasHistoryReturn><![CDATA[<claim-history>
<request>
  <vin>WBA3N51030KS15173</vin>
  <firstRegistration>2021-04-15</firstRegistration>
  <engineCC>1997</engineCC>
</request>
<result>true</result>
<photosIdentifier>fcf5b31c-1153-11f0-9994-005056a724e</photosIdentifier>
<photosStatus>POSSIBLY_AVAILABLE</photosStatus>
<isMileage>true</isMileage>
<resultShortVIN>false</resultShortVIN>
<resultFullVIN>true</resultFullVIN>
</claim-history>]]></ns2:hasHistoryReturn>
    </ns2:hasHistoryResponse>
  </SOAP-ENV:Body>
</SOAP-ENV:Envelope>`;

export const CHE_HAS_HISTORY_NEGATIVE_RESPONSE = `<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/">
  <SOAP-ENV:Header/>
  <SOAP-ENV:Body>
    <ns2:hasHistoryResponse xmlns:ns2="urn:HistoryWSDL">
      <ns2:hasHistoryReturn><![CDATA[<claim-history>
<request>
  <vin>WVWZZZ3CZWE123456</vin>
  <firstRegistration>2022-01-10</firstRegistration>
</request>
<result>false</result>
<resultShortVIN>false</resultShortVIN>
<resultFullVIN>false</resultFullVIN>
<advice>Brak wpisów w bazie Audatex dla podanych parametrów.</advice>
<photosStatus>NO_PHOTOS</photosStatus>
</claim-history>]]></ns2:hasHistoryReturn>
    </ns2:hasHistoryResponse>
  </SOAP-ENV:Body>
</SOAP-ENV:Envelope>`;

export const CHE_GET_DETAILS_RESPONSE = `<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/">
  <SOAP-ENV:Header/>
  <SOAP-ENV:Body>
    <ns2:getDetailsResponse xmlns:ns2="urn:HistoryWSDL">
      <ns2:getDetailsReturn><![CDATA[<claim-history>
<request>
  <vin>WBA3N51030KS15173</vin>
</request>
<result>
  <claim id="2023-11-12.POL.12D6483330E754FC10CA4A0C640005FC">
    <claim>
      <accident-date>2023-11-10</accident-date>
      <technical-control>
        <code>D1</code>
      </technical-control>
    </claim>
    <assessment>
      <mandate>
        <code>D1</code>
      </mandate>
      <currency>PLN</currency>
      <damage-value>18450.00</damage-value>
      <damage-groups>002,004,006</damage-groups>
      <damage-positions>01,02,08</damage-positions>
    </assessment>
    <vehicle>
      <car-manufacturer>BMW</car-manufacturer>
      <car-model>Seria 4 Coupé F32</car-model>
      <engine-cc>1997</engine-cc>
      <first-registration>2021-04-15</first-registration>
      <mileage>45200</mileage>
    </vehicle>
    <country>POL</country>
    <creation>2023-11-12</creation>
    <damage>
      <general>
        <front>Y</front>
        <front-left>Y</front-left>
        <front-right/>
        <interior/>
        <mechanical/>
        <rear/>
        <rear-left/>
        <rear-right/>
        <roof/>
        <side-left/>
        <side-right/>
        <underbody/>
      </general>
      <glass>
        <front>Y</front>
        <rear/>
        <roof/>
        <side-left/>
        <side-right/>
      </glass>
    </damage>
  </claim>
  <claim id="2024-05-08.AON.1202405082063156">
    <claim>
      <accident-date>2024-05-05</accident-date>
      <technical-control>
        <code>RW</code>
      </technical-control>
    </claim>
    <assessment>
      <mandate>
        <code>RW</code>
      </mandate>
      <currency>PLN</currency>
      <damage-value>85200.00</damage-value>
      <damage-groups>001,002,003,004,005</damage-groups>
      <damage-positions>01,02,03,04,05,10,11</damage-positions>
    </assessment>
    <vehicle>
      <car-manufacturer>BMW</car-manufacturer>
      <car-model>Seria 4 Coupé F32</car-model>
      <engine-cc>1997</engine-cc>
      <first-registration>2021-04-15</first-registration>
      <mileage>52100</mileage>
    </vehicle>
    <country>AON</country>
    <creation>2024-05-08</creation>
    <damage>
      <general>
        <front>Y</front>
        <front-left>Y</front-left>
        <front-right>Y</front-right>
        <interior>Y</interior>
        <mechanical>Y</mechanical>
        <rear/>
        <rear-left/>
        <rear-right/>
        <roof/>
        <side-left>Y</side-left>
        <side-right/>
        <underbody>Y</underbody>
      </general>
      <glass>
        <front>Y</front>
        <rear/>
        <roof/>
        <side-left>Y</side-left>
        <side-right/>
      </glass>
    </damage>
  </claim>
</result>
</claim-history>]]></ns2:getDetailsReturn>
    </ns2:getDetailsResponse>
  </SOAP-ENV:Body>
</SOAP-ENV:Envelope>`;

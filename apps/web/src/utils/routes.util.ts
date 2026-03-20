export enum ApplicationRoute {
  Dashboard = "/",
  Settings = "/settings",
  Login = "/login",
  Connectors = "/connectors",
  ConnectorInstance = "/connectors/$connectorInstanceId",
  Entities = "/entities",
  Entity = "/entities/$entityId",
  EntityRecord = "/entities/$entityId/records/$recordId",
  ColumnDefinitions = "/column-definitions",
  ColumnDefinition = "/column-definitions/$columnDefinitionId",
  Jobs = "/jobs",
}

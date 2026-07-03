<?php

namespace ElementorPro\Modules\Interactions;

use ElementorPro\Plugin;
use ElementorPro\Base\Module_Base;
use ElementorPro\Core\Utils as ProUtils;
use Elementor\Modules\AtomicWidgets\Module as AtomicWidgetsModule;
use Elementor\Modules\Interactions\Module as InteractionsModule;
use Elementor\Core\Experiments\Manager as ExperimentsManager;
use ElementorPro\License\API;
use ElementorPro\License\Admin;

if ( ! defined( 'ABSPATH' ) ) {
	exit; // Exit if accessed directly
}

class Module extends Module_Base {
	const EXPERIMENT_NAME = 'e_pro_interactions';

	public function get_name() {
		return ProUtils::get_class_constant( InteractionsModule::class, 'MODULE_NAME', 'e-interactions' );
	}

	public static function get_experimental_data(): array {
		return [
			'name' => self::EXPERIMENT_NAME,
			'title' => esc_html__( 'Pro Interactions', 'elementor-pro' ),
			'description' => esc_html__( 'Enhanced interactions with replay support. Note: This feature requires both the "Atomic Widgets" and "Interactions" experiments to be enabled.', 'elementor-pro' ),
			'hidden' => true,
			'default' => ExperimentsManager::STATE_ACTIVE,
			'release_status' => ExperimentsManager::RELEASE_STATUS_DEV,
		];
	}

	private function is_supported_by_current_license() {
		if ( empty( \ElementorPro\License\Admin::get_license_key() ) ) {
			return false;
		}

		if ( ! API::is_license_active() ) {
			return false;
		}

		return API::is_licence_has_feature( 'pro-interactions', API::BC_VALIDATION_CALLBACK );
	}

	private function hooks() {
		return new Hooks();
	}

	public function __construct() {
		parent::__construct();

		if ( ! $this->is_experiment_active() || ! $this->is_supported_by_current_license() ) {
			return;
		}

		$this->hooks()->register();
	}

	private function is_experiment_active(): bool {
		return version_compare( ELEMENTOR_VERSION, '4.0', '>=' )
			&& class_exists( 'Elementor\\Modules\\Interactions\\Module' )
			&& Plugin::elementor()->experiments->is_feature_active( self::EXPERIMENT_NAME )
			&& Plugin::elementor()->experiments->is_feature_active( AtomicWidgetsModule::EXPERIMENT_NAME )
			&& Plugin::elementor()->experiments->is_feature_active( ProUtils::get_class_constant( InteractionsModule::class, 'EXPERIMENT_NAME', 'e_interactions' ) );
	}
}

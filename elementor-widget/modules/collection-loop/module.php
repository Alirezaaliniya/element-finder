<?php
namespace ElementorPro\Modules\CollectionLoop;

use Elementor\Core\Experiments\Manager as ExperimentsManager;
use Elementor\Modules\AtomicWidgets\Module as AtomicWidgetsModule;
use ElementorPro\Base\Module_Base;
use ElementorPro\Modules\CollectionLoop\Elements\Collection_Loop\Collection_Loop;
use ElementorPro\Modules\CollectionLoop\Elements\Collection_Loop_Item\Collection_Loop_Item;
use ElementorPro\Modules\CollectionLoop\Elements\Collection_Loop_Layout\Collection_Loop_Layout;
use ElementorPro\Plugin;

if ( ! defined( 'ABSPATH' ) ) {
	exit; // Exit if accessed directly.
}

class Module extends Module_Base {
	const MODULE_NAME = 'e-collection-loop';
	const EXPERIMENT_NAME = 'e_pro_collection_loop';
	const PACKAGE_HANDLE = 'editor-collection-loop';

	public function get_name() {
		return self::MODULE_NAME;
	}

	public static function get_experimental_data(): array {
		return [
			'name' => self::EXPERIMENT_NAME,
			'title' => esc_html__( 'Collection Loop', 'elementor-pro' ),
			'description' => esc_html__( 'Collection Loop element for repeating dynamic content. Note: This feature requires the "Atomic Widgets" experiment to be enabled.', 'elementor-pro' ),
			'hidden' => true,
			'default' => ExperimentsManager::STATE_INACTIVE,
			'release_status' => ExperimentsManager::RELEASE_STATUS_DEV,
		];
	}

	public function __construct() {
		parent::__construct();

		if ( ! $this->is_experiment_active() ) {
			return;
		}

		add_action(
			'elementor/elements/elements_registered',
			fn ( $elements_manager ) => $this->register_elements( $elements_manager )
		);

		add_filter(
			'elementor-pro/editor/v2/packages',
			fn ( $packages ) => array_merge( $packages, [ self::PACKAGE_HANDLE ] )
		);
	}

	private function is_experiment_active(): bool {
		return version_compare( ELEMENTOR_VERSION, '4.0', '>=' )
			&& Plugin::elementor()->experiments->is_feature_active( self::EXPERIMENT_NAME )
			&& Plugin::elementor()->experiments->is_feature_active( AtomicWidgetsModule::EXPERIMENT_NAME );
	}

	private function register_elements( $elements_manager ) {
		$elements_manager->register_element_type( new Collection_Loop() );
		$elements_manager->register_element_type( new Collection_Loop_Layout() );
		$elements_manager->register_element_type( new Collection_Loop_Item() );
	}
}
